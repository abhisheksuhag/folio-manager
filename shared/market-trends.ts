export const MARKET_TRENDS = [
  {
    id: "SP500",
    name: "S&P 500",
    instrument: "SPY ETF proxy",
    currency: "USD",
  },
  {
    id: "QQQ",
    name: "Nasdaq-100",
    instrument: "QQQ ETF proxy",
    currency: "USD",
  },
  { id: "NIFTY50", name: "NIFTY 50", instrument: "Index", currency: null },
] as const;
export type MarketTrendId = (typeof MARKET_TRENDS)[number]["id"];
export interface DailyClose {
  date: string;
  value: number;
}
export interface MarketTrend {
  id: MarketTrendId;
  name: string;
  instrument: string;
  currency: "USD" | null;
  points: DailyClose[];
  source: string;
  stale?: boolean;
  notice?: string;
}

/** A single calculation keeps the line and its change label on the same period. */
export function trendGeometry(points: DailyClose[]) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const low = Math.min(...values),
    high = Math.max(...values),
    range = high - low;
  const coords = values.map((value, i) => ({
    x: 3 + (i / (values.length - 1)) * 90,
    y: range ? 33 - ((value - low) / range) * 28 : 19,
  }));
  return {
    path: coords
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" "),
    end: coords.at(-1)!,
    change: (values.at(-1)! / values[0] - 1) * 100,
  };
}
