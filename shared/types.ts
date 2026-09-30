export type Currency = 'INR' | 'USD';
export type Broker = 'INDmoney' | 'Upstox' | 'Binance' | 'Manual';
export type AssetClass = 'US equity' | 'Indian equity' | 'Mutual fund' | 'ETF' | 'Crypto' | 'Retirement' | 'Cash';
export interface Security { id: string; ticker: string; name: string; exchange: string; currency: Currency; country: 'US' | 'IN' | 'GLOBAL'; assetClass: AssetClass; sector: string; isin?: string; color: string; logo?: string; price: number; previousClose: number; marketCap?: number; pe?: number; eps?: number; dividendYield?: number; high52?: number; low52?: number; volume?: number; description?: string; indices: string[]; asOf: string; source: string; }
export interface Holding { id: string; security: Security; broker: Broker; accountId: string; quantity: number; averagePrice: number; }
export type TransactionType = 'Buy' | 'Sell' | 'Dividend' | 'Deposit' | 'Withdrawal' | 'MF purchase' | 'MF redemption' | 'Split' | 'Fee' | 'Tax';
export interface Transaction { id: string; date: string; securityId?: string; ticker: string; name: string; broker: Broker; accountId: string; type: TransactionType; quantity: number; price: number; amount: number; currency: Currency; splitRatio?: number; }
export interface HistoryPoint { date: string; value: number; invested: number; netFlow: number; benchmark?: number; }
export interface FinancialPeriod { year: string; revenue: number; netIncome: number; freeCashFlow: number; operatingMargin: number; netMargin: number; eps: number; debt: number; cash: number; roe: number; roce?: number; }
export interface Fundamentals { periods: FinancialPeriod[]; currency: Currency; source: string; asOf: string; }
export interface Watchlist { id: string; name: string; securityIds: string[]; }
export interface Connection { id: string; broker: Broker; status: 'connected' | 'disconnected' | 'expired'; method: 'demo' | 'oauth' | 'csv' | 'mcp' | 'apikey'; lastSync?: string; holdingsCount: number; permissions: string[]; }
export interface User { id: string; name: string; email: string; currency: Currency; demo: boolean; }
export interface Capabilities { upstox: boolean; indmoney: boolean; binance: boolean; marketData: boolean; ai: boolean; }
export interface Workspace { user: User; holdings: Holding[]; transactions: Transaction[]; history: HistoryPoint[]; securities: Security[]; watchlists: Watchlist[]; connections: Connection[]; fx: { USDINR: number; asOf: string; source: string }; capabilities: Capabilities; asOf: string; mode: 'demo' | 'live'; }
export interface StockData { security: Security; history: HistoryPoint[]; fundamentals: Fundamentals; peers: Security[]; composition?: FundComposition; notices?: string[]; }
export interface FundConstituent { name: string; ticker?: string; securityId?: string; isin?: string; weight: number; sector?: string; country?: string; assetClass?: string; }
export interface FundAllocation { name: string; weight: number; }
export interface FundComposition {
  status: 'available' | 'partial' | 'unavailable'; holdings: FundConstituent[];
  sectors: FundAllocation[]; countries: FundAllocation[]; assetAllocation: FundAllocation[];
  asOf: string | null; fetchedAt: string; source: string; sourceUrl?: string; reason?: string;
  reportedHoldingCount?: number; expenseRatio?: number; aum?: number; benchmark?: string; category?: string;
}
export interface IndexMetadata { id: string; name: string; country: 'IN' | 'US'; }
export interface IndexData { id: string; name: string; securities: Security[]; source: string; sourceUrl?: string; asOf: string; complete: boolean; notice?: string; }
export interface ScreenerData { securities: Security[]; indices: IndexMetadata[]; source: string; asOf: string; complete: boolean; notices: string[]; }
export interface AnalysisMessage { id: string; role: 'user' | 'assistant'; content: string; sources?: string[]; kind?: 'calculated' | 'ai'; date: string; }
export interface AnalysisResult { message: AnalysisMessage; }
export interface PortfolioProvider { getHoldings(userId: string): Promise<Holding[]>; getTransactions(userId: string): Promise<Transaction[]>; }
export interface BrokerageProvider extends PortfolioProvider { readonly id: Broker; readonly permissions: readonly string[]; }
export interface MarketDataProvider { search(query: string): Promise<Security[]>; quote(id: string): Promise<Security>; constituents(index: string): Promise<Security[]>; }
export interface HistoricalDataProvider { history(id: string): Promise<HistoryPoint[]>; }
export interface FundamentalsProvider { fundamentals(id: string): Promise<Fundamentals>; }
export interface NewsProvider { news(id: string): Promise<{ title: string; url: string; date: string; source: string }[]>; }
export interface AIAnalysisProvider { analyze(question: string, workspace: Workspace, stock?: StockData): Promise<AnalysisResult>; }
