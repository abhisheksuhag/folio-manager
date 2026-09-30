import type { Connection, FinancialPeriod, FundComposition, Holding, HistoryPoint, Security, StockData, Transaction, User, Watchlist, Workspace } from '../../shared/types.ts';

export const DEMO_AS_OF = '2026-09-04';
export const DEMO_FX = 87.45;
export const DEMO_SOURCE = 'Illustrative demo data';

type SecuritySeed = Omit<Security, 'id' | 'asOf' | 'source' | 'color'> & { country: 'US' | 'IN' };
const colors = ['#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#4f46e5','#0d9488'];

function security(seed: SecuritySeed, index: number): Security {
  return {
    ...seed,
    id: `${seed.country.toLowerCase()}:${seed.exchange.toLowerCase()}:${seed.ticker.toLowerCase()}`,
    color: colors[index % colors.length],
    asOf: DEMO_AS_OF,
    source: DEMO_SOURCE,
  };
}

const seeds: SecuritySeed[] = [
  {ticker:'AAPL',name:'Apple',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Technology',price:226,previousClose:224.2,marketCap:3_400_000_000_000,pe:34,eps:6.65,dividendYield:0.45,high52:237,low52:164,volume:48_000_000,indices:['SP500','QQQ'],description:'Consumer devices and digital services.'},
  {ticker:'MSFT',name:'Microsoft',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Technology',price:510,previousClose:506,marketCap:3_790_000_000_000,pe:37,eps:13.8,dividendYield:0.66,high52:520,low52:344,volume:22_000_000,indices:['SP500','QQQ'],description:'Software, cloud infrastructure and productivity products.'},
  {ticker:'NVDA',name:'NVIDIA',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Semiconductors',price:175,previousClose:173.9,marketCap:4_260_000_000_000,pe:48,eps:3.64,dividendYield:0.03,high52:184,low52:86,volume:155_000_000,indices:['SP500','QQQ'],description:'Accelerated computing platforms and semiconductors.'},
  {ticker:'GOOGL',name:'Alphabet',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Communication services',price:245,previousClose:243.6,marketCap:3_000_000_000_000,pe:27,eps:9.1,dividendYield:0.33,high52:251,low52:142,volume:31_000_000,indices:['SP500','QQQ'],description:'Internet services, advertising and cloud computing.'},
  {ticker:'AMZN',name:'Amazon',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Consumer discretionary',price:235,previousClose:233.9,marketCap:2_490_000_000_000,pe:36,eps:6.5,high52:242,low52:151,volume:39_000_000,indices:['SP500','QQQ'],description:'Online retail, logistics and cloud computing.'},
  {ticker:'QQQ',name:'Invesco QQQ Trust',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'ETF',sector:'Diversified',price:565,previousClose:561.8,dividendYield:0.55,high52:577,low52:402,volume:42_000_000,indices:['QQQ'],description:'ETF tracking the Nasdaq-100 index.'},
  {ticker:'RELIANCE',name:'Reliance Industries',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Energy',price:1380,previousClose:1374,marketCap:18_670_000_000_000,pe:25,eps:55.2,dividendYield:0.72,high52:1608,low52:1115,volume:8_400_000,indices:['NIFTY50','NIFTY100','NIFTY500'],description:'Energy, materials, retail and digital services conglomerate.'},
  {ticker:'HDFCBANK',name:'HDFC Bank',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Financials',price:980,previousClose:975,marketCap:15_010_000_000_000,pe:21,eps:46.7,dividendYield:1.1,high52:1012,low52:714,volume:12_000_000,indices:['NIFTY50','NIFTY100','NIFTY500'],description:'Private-sector bank serving retail and corporate customers.'},
  {ticker:'TCS',name:'Tata Consultancy Services',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Technology',price:3250,previousClose:3232,marketCap:11_760_000_000_000,pe:24,eps:135.4,dividendYield:1.9,high52:4592,low52:3056,volume:2_100_000,indices:['NIFTY50','NIFTY100','NIFTY500'],description:'Information technology services and consulting.'},
  {ticker:'INFY',name:'Infosys',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Technology',price:1540,previousClose:1531,marketCap:6_380_000_000_000,pe:23,eps:67,dividendYield:2.8,high52:2006,low52:1308,volume:7_800_000,indices:['NIFTY50','NIFTY100','NIFTY500'],description:'Digital services, consulting and outsourcing.'},
  {ticker:'PPFAS',name:'Parag Parikh Flexi Cap Fund',exchange:'MF',currency:'INR',country:'IN',assetClass:'Mutual fund',sector:'Diversified',price:260,previousClose:259.2,indices:[],description:'Illustrative diversified equity mutual fund holding.'},
  {ticker:'UTINIFTY',name:'UTI Nifty 50 Index Fund',exchange:'MF',currency:'INR',country:'IN',assetClass:'Mutual fund',sector:'Diversified',price:190,previousClose:189.5,indices:['NIFTY50'],description:'Illustrative index mutual fund holding.'},
  {ticker:'META',name:'Meta Platforms',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Communication services',price:748,previousClose:742,indices:['SP500','QQQ']},
  {ticker:'TSLA',name:'Tesla',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Consumer discretionary',price:354,previousClose:348,indices:['SP500','QQQ']},
  {ticker:'AVGO',name:'Broadcom',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Semiconductors',price:342,previousClose:338,indices:['SP500','QQQ']},
  {ticker:'JPM',name:'JPMorgan Chase',exchange:'NYSE',currency:'USD',country:'US',assetClass:'US equity',sector:'Financials',price:318,previousClose:316,indices:['SP500']},
  {ticker:'V',name:'Visa',exchange:'NYSE',currency:'USD',country:'US',assetClass:'US equity',sector:'Financials',price:366,previousClose:363,indices:['SP500']},
  {ticker:'WMT',name:'Walmart',exchange:'NYSE',currency:'USD',country:'US',assetClass:'US equity',sector:'Consumer staples',price:103,previousClose:102.4,indices:['SP500']},
  {ticker:'ICICIBANK',name:'ICICI Bank',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Financials',price:1420,previousClose:1411,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'BHARTIARTL',name:'Bharti Airtel',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Communication services',price:2025,previousClose:2012,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'LT',name:'Larsen & Toubro',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Industrials',price:3740,previousClose:3718,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'SBIN',name:'State Bank of India',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Financials',price:875,previousClose:869,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'SUNPHARMA',name:'Sun Pharmaceutical',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Healthcare',price:1760,previousClose:1751,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'MARUTI',name:'Maruti Suzuki India',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Consumer discretionary',price:15100,previousClose:15040,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'TATAMOTORS',name:'Tata Motors',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Consumer discretionary',price:710,previousClose:705,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'ITC',name:'ITC',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Consumer staples',price:420,previousClose:417.5,indices:['NIFTY50','NIFTY100','NIFTY500']},
  {ticker:'ASIANPAINT',name:'Asian Paints',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Materials',price:2510,previousClose:2492,indices:['NIFTY100','NIFTY500']},
  {ticker:'DMART',name:'Avenue Supermarts',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Consumer staples',price:4720,previousClose:4690,indices:['NIFTY100','NIFTY500']},
  {ticker:'PIDILITIND',name:'Pidilite Industries',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Materials',price:3080,previousClose:3065,indices:['NIFTY100','NIFTY500']},
  {ticker:'NYKAA',name:'FSN E-Commerce Ventures',exchange:'NSE',currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Consumer discretionary',price:225,previousClose:221,indices:['NIFTY500']},
];

export const demoSecurities = seeds.map(security);
const byTicker = new Map(demoSecurities.map((item) => [item.ticker, item]));

const holdingSeeds = [
  ['AAPL','INDmoney','us-growth',8,184],['MSFT','INDmoney','us-growth',4,405],['NVDA','INDmoney','us-growth',12,132],
  ['GOOGL','INDmoney','us-growth',8,198],['AMZN','INDmoney','us-growth',6,190],['QQQ','INDmoney','us-growth',3,470],
  ['RELIANCE','Upstox','india-main',250,1110],['HDFCBANK','Upstox','india-main',180,795],['TCS','Upstox','india-main',70,2780],
  ['INFY','Upstox','india-main',130,1290],['PPFAS','Manual','mutual-funds',1000,220],['UTINIFTY','Manual','mutual-funds',1100,158],
] as const;

export const demoHoldings: Holding[] = holdingSeeds.map(([ticker,broker,accountId,quantity,averagePrice], index) => ({
  id: `demo-holding-${index + 1}`,
  security: byTicker.get(ticker)!, broker, accountId, quantity, averagePrice,
}));

export const demoCurrentValue = demoHoldings.reduce((sum, holding) => sum + holding.quantity * holding.security.price * (holding.security.currency === 'USD' ? DEMO_FX : 1), 0);
export const demoInvestedValue = demoHoldings.reduce((sum, holding) => sum + holding.quantity * holding.averagePrice * (holding.security.currency === 'USD' ? DEMO_FX : 1), 0);

function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }

export const demoHistory: HistoryPoint[] = (() => {
  const start = new Date('2024-09-05T00:00:00Z');
  const end = new Date(`${DEMO_AS_OF}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const result: HistoryPoint[] = [];
  let previousInvested = 1_150_000;
  for (let day = 0; day <= days; day += 1) {
    const progress = day / days;
    const date = new Date(start.getTime() + day * 86_400_000);
    const invested = day === days ? demoInvestedValue : 1_150_000 + (demoInvestedValue - 1_150_000) * progress;
    const growth = 1 + 0.185 * progress + 0.018 * Math.sin(progress * Math.PI * 9) - 0.012 * Math.sin(progress * Math.PI * 4);
    const rawValue = invested * growth;
    const endScale = demoCurrentValue / (demoInvestedValue * 1.185);
    const value = day === days ? demoCurrentValue : rawValue * (1 + (endScale - 1) * progress);
    const benchmark = 1_150_000 * (1 + 0.145 * progress + 0.014 * Math.sin(progress * Math.PI * 7));
    result.push({ date: dateOnly(date), value: day===days?demoCurrentValue:Math.round(value), invested: day===days?demoInvestedValue:Math.round(invested), netFlow: day === 0 ? Math.round(invested) : day===days?demoInvestedValue-previousInvested:Math.round(invested - previousInvested), benchmark: Math.round(benchmark) });
    previousInvested = invested;
  }
  return result;
})();

export const demoTransactions: Transaction[] = [
  {id:'demo-tx-1',date:'2024-09-05',ticker:'CASH',name:'Initial deposit',broker:'Manual',accountId:'cash',type:'Deposit',quantity:0,price:0,amount:1_150_000,currency:'INR'},
  {id:'demo-tx-2',date:'2024-09-09',securityId:byTicker.get('RELIANCE')!.id,ticker:'RELIANCE',name:'Reliance Industries',broker:'Upstox',accountId:'india-main',type:'Buy',quantity:150,price:1050,amount:157500,currency:'INR'},
  {id:'demo-tx-3',date:'2024-10-15',securityId:byTicker.get('AAPL')!.id,ticker:'AAPL',name:'Apple',broker:'INDmoney',accountId:'us-growth',type:'Buy',quantity:5,price:178,amount:890,currency:'USD'},
  {id:'demo-tx-4',date:'2025-01-06',securityId:byTicker.get('PPFAS')!.id,ticker:'PPFAS',name:'Parag Parikh Flexi Cap Fund',broker:'Manual',accountId:'mutual-funds',type:'MF purchase',quantity:600,price:205,amount:123000,currency:'INR'},
  {id:'demo-tx-5',date:'2025-03-14',securityId:byTicker.get('MSFT')!.id,ticker:'MSFT',name:'Microsoft',broker:'INDmoney',accountId:'us-growth',type:'Dividend',quantity:4,price:0,amount:3.32,currency:'USD'},
  {id:'demo-tx-6',date:'2025-07-08',securityId:byTicker.get('TCS')!.id,ticker:'TCS',name:'Tata Consultancy Services',broker:'Upstox',accountId:'india-main',type:'Buy',quantity:30,price:3350,amount:100500,currency:'INR'},
  {id:'demo-tx-7',date:'2026-01-12',securityId:byTicker.get('NVDA')!.id,ticker:'NVDA',name:'NVIDIA',broker:'INDmoney',accountId:'us-growth',type:'Buy',quantity:4,price:148,amount:592,currency:'USD'},
  {id:'demo-tx-8',date:'2026-06-19',securityId:byTicker.get('HDFCBANK')!.id,ticker:'HDFCBANK',name:'HDFC Bank',broker:'Upstox',accountId:'india-main',type:'Dividend',quantity:180,price:0,amount:3960,currency:'INR'},
];

const demoConnections: Connection[] = [
  {id:'demo-indmoney',broker:'INDmoney',status:'connected',method:'demo',lastSync:`${DEMO_AS_OF}T15:30:00.000Z`,holdingsCount:6,permissions:['illustrative holdings']},
  {id:'demo-upstox',broker:'Upstox',status:'connected',method:'demo',lastSync:`${DEMO_AS_OF}T15:30:00.000Z`,holdingsCount:4,permissions:['illustrative holdings']},
  {id:'demo-manual',broker:'Manual',status:'connected',method:'demo',lastSync:`${DEMO_AS_OF}T15:30:00.000Z`,holdingsCount:2,permissions:['illustrative holdings']},
];

export const demoIndices = [
  {id:'SP500',name:'S&P 500',country:'US' as const}, {id:'QQQ',name:'Nasdaq-100',country:'US' as const}, {id:'NIFTY50',name:'Nifty 50',country:'IN' as const},
  {id:'NIFTY100',name:'Nifty 100',country:'IN' as const}, {id:'NIFTY500',name:'Nifty 500',country:'IN' as const},
];

const compositionBase={fetchedAt:`${DEMO_AS_OF}T15:30:00.000Z`,source:DEMO_SOURCE,sourceUrl:'https://example.invalid/illustrative-fund-data'};
const demoCompositions:Record<string,FundComposition>={
  QQQ:{...compositionBase,status:'partial',asOf:'2026-08-31',expenseRatio:0.2,aum:410_000_000_000,reportedHoldingCount:101,benchmark:'Nasdaq-100',category:'Large growth ETF',holdings:[
    {name:'NVIDIA',ticker:'NVDA',securityId:'us:nasdaq:nvda',weight:9.1,sector:'Semiconductors',country:'US',assetClass:'US equity'},
    {name:'Microsoft',ticker:'MSFT',securityId:'us:nasdaq:msft',weight:8.4,sector:'Technology',country:'US',assetClass:'US equity'},
    {name:'Apple',ticker:'AAPL',securityId:'us:nasdaq:aapl',weight:7.6,sector:'Technology',country:'US',assetClass:'US equity'},
  ],sectors:[{name:'Technology',weight:50.2},{name:'Communication services',weight:15.4},{name:'Consumer discretionary',weight:12.1}],countries:[{name:'United States',weight:96.8},{name:'Other',weight:3.2}],assetAllocation:[{name:'Equity',weight:99.6},{name:'Cash',weight:0.4}],reason:'Top holdings are illustrative; 74.9% of published holdings are not shown.'},
  PPFAS:{...compositionBase,status:'partial',asOf:'2026-08-31',expenseRatio:0.63,aum:1_250_000_000_000,reportedHoldingCount:35,benchmark:'Nifty 500 TRI',category:'Flexi cap',holdings:[
    {name:'HDFC Bank',ticker:'HDFCBANK',securityId:'in:nse:hdfcbank',weight:7.8,sector:'Financials',country:'IN',assetClass:'Indian equity'},
    {name:'Alphabet',ticker:'GOOGL',securityId:'us:nasdaq:googl',weight:6.4,sector:'Communication services',country:'US',assetClass:'US equity'},
    {name:'Microsoft',ticker:'MSFT',securityId:'us:nasdaq:msft',weight:5.7,sector:'Technology',country:'US',assetClass:'US equity'},
  ],sectors:[{name:'Financials',weight:28},{name:'Technology',weight:17},{name:'Communication services',weight:12}],countries:[{name:'India',weight:70},{name:'United States',weight:18}],assetAllocation:[{name:'Equity',weight:88},{name:'Cash and equivalents',weight:12}],reason:'Selected holdings are illustrative; the remainder is intentionally unreported.'},
  UTINIFTY:{...compositionBase,status:'partial',asOf:'2026-08-31',expenseRatio:0.18,aum:210_000_000_000,reportedHoldingCount:50,benchmark:'Nifty 50 TRI',category:'Index mutual fund',holdings:[
    {name:'Reliance Industries',ticker:'RELIANCE',securityId:'in:nse:reliance',weight:9.6,sector:'Energy',country:'IN',assetClass:'Indian equity'},
    {name:'HDFC Bank',ticker:'HDFCBANK',securityId:'in:nse:hdfcbank',weight:8.2,sector:'Financials',country:'IN',assetClass:'Indian equity'},
    {name:'ICICI Bank',ticker:'ICICIBANK',securityId:'in:nse:icicibank',weight:7.1,sector:'Financials',country:'IN',assetClass:'Indian equity'},
  ],sectors:[{name:'Financials',weight:34},{name:'Technology',weight:13},{name:'Energy',weight:12}],countries:[{name:'India',weight:100}],assetAllocation:[{name:'Equity',weight:99.7},{name:'Cash',weight:0.3}],reason:'Selected holdings are illustrative; the remainder is intentionally unreported.'},
};

export function demoFundComposition(id:string):FundComposition|undefined {
  const security=demoSecurities.find((item)=>item.id===id);
  return security?demoCompositions[security.ticker]:undefined;
}

export function demoWorkspace(user: User, watchlists: Watchlist[]): Workspace {
  return {user,holdings:demoHoldings,transactions:demoTransactions,history:demoHistory,securities:demoSecurities,watchlists,connections:demoConnections,fx:{USDINR:DEMO_FX,asOf:DEMO_AS_OF,source:DEMO_SOURCE},capabilities:{upstox:false,indmoney:false,binance:false,marketData:true,ai:false},asOf:DEMO_AS_OF,mode:'demo'};
}

function financialPeriods(item: Security): FinancialPeriod[] {
  const base = item.currency === 'USD' ? Math.max(item.marketCap ?? 150_000_000_000, 1_000_000_000) / 8 : Math.max(item.marketCap ?? 900_000_000_000, 1_000_000_000) / 7;
  return ['2022','2023','2024','2025','2026'].map((year,index)=>({year,revenue:Math.round(base*(0.72+index*0.07)),netIncome:Math.round(base*(0.12+index*0.012)),freeCashFlow:Math.round(base*(0.1+index*0.011)),operatingMargin:21+index*1.1,netMargin:16+index*0.8,eps:Number(((item.eps??4)*(0.7+index*0.075)).toFixed(2)),debt:Math.round(base*(0.38-index*0.035)),cash:Math.round(base*(0.22+index*0.025)),roe:18+index*1.2,roce:17+index}));
}

export function demoStock(id: string): StockData | null {
  const security = demoSecurities.find((item)=>item.id===id);
  if (!security) return null;
  const history = demoHistory.slice(-365).map((point,index,all)=>({date:point.date,value:Number((security.price*(0.76+0.24*index/(all.length-1)+0.035*Math.sin(index/18))).toFixed(2)),invested:0,netFlow:0}));
  history[history.length-1].value=security.price;
  const composition=demoFundComposition(id);
  return {security,history,fundamentals:{periods:composition?[]:financialPeriods(security),currency:security.currency,source:composition?'Not applicable to funds':DEMO_SOURCE,asOf:DEMO_AS_OF},peers:composition?[]:demoSecurities.filter((item)=>item.id!==id&&item.sector===security.sector).slice(0,4),...(composition?{composition}:{} )};
}

export function demoConstituents(indexId:string):Security[]|null {
  if (!demoIndices.some((index)=>index.id===indexId)) return null;
  return demoSecurities.filter((security)=>security.indices.includes(indexId));
}
