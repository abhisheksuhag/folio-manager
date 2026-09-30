import type { Currency, HistoryPoint, Holding, Transaction } from "./types.ts";
export function convert(
  value: number,
  from: Currency,
  to: Currency,
  fx: number,
) {
  if (from === to) return value;
  if (!Number.isFinite(fx) || fx <= 0)
    throw new Error("A valid USD/INR exchange rate is required.");
  return from === "USD" ? value * fx : value / fx;
}
export function holdingValues(h: Holding, fx: number, currency: Currency) {
  const value = convert(
    h.quantity * h.security.price,
    h.security.currency,
    currency,
    fx,
  );
  const invested = convert(
    h.quantity * h.averagePrice,
    h.security.currency,
    currency,
    fx,
  );
  const previous = convert(
    h.quantity * h.security.previousClose,
    h.security.currency,
    currency,
    fx,
  );
  return {
    value,
    invested,
    gain: value - invested,
    percent: invested > 0 ? (value / invested - 1) * 100 : 0,
    daily: value - previous,
    dailyPercent: previous > 0 ? (value / previous - 1) * 100 : 0,
  };
}
export function portfolioTotals(
  holdings: Holding[],
  fx: number,
  currency: Currency,
) {
  const totals = holdings.reduce(
    (t, h) => {
      const v = holdingValues(h, fx, currency);
      return {
        value: t.value + v.value,
        invested: t.invested + v.invested,
        daily: t.daily + v.daily,
      };
    },
    { value: 0, invested: 0, daily: 0 },
  );
  return {
    ...totals,
    gain: totals.value - totals.invested,
    percent:
      totals.invested > 0 ? (totals.value / totals.invested - 1) * 100 : 0,
    dailyPercent:
      totals.value - totals.daily > 0
        ? (totals.daily / (totals.value - totals.daily)) * 100
        : 0,
  };
}
export function allocation(
  holdings: Holding[],
  fx: number,
  currency: Currency,
  group: "assetClass" | "country" | "sector" | "broker" = "assetClass",
) {
  const groups = new Map<string, number>();
  for (const h of holdings) {
    const key = group === "broker" ? h.broker : h.security[group];
    groups.set(
      key,
      (groups.get(key) || 0) + holdingValues(h, fx, currency).value,
    );
  }
  const total = [...groups.values()].reduce((a, b) => a + b, 0);
  return [...groups.entries()]
    .map(([name, value]) => ({
      name,
      value,
      weight: total > 0 ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}
/** End-of-period cash-flow convention. Full returns require complete valuation/flow history. */
export function timeWeightedReturns(
  points: HistoryPoint[],
): (HistoryPoint & { return: number })[] {
  let unit = 1;
  return points.map((p, i) => {
    if (i > 0 && points[i - 1].value > 0)
      unit *= (p.value - p.netFlow) / points[i - 1].value;
    return { ...p, return: (unit - 1) * 100 };
  });
}
export function riskMetrics(points: HistoryPoint[], riskFreeRate = 0) {
  const adjusted = timeWeightedReturns(points);
  let peak = 1;
  let maxDrawdown = 0;
  for (const p of adjusted) {
    const value = 1 + p.return / 100;
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, (value / peak - 1) * 100);
  }
  const days =
    points.length > 1
      ? (Date.parse(points.at(-1)!.date) - Date.parse(points[0].date)) /
        86400000
      : 0;
  const daily = adjusted
    .slice(1)
    .map((p, i) => (1 + p.return / 100) / (1 + adjusted[i].return / 100) - 1)
    .filter(Number.isFinite);
  const gaps = points
    .slice(1)
    .map(
      (p, i) => (Date.parse(p.date) - Date.parse(points[i].date)) / 86400000,
    );
  const dailyFrequency = gaps.length > 0 && gaps.every((d) => d > 0 && d <= 4);
  const annualFactor = gaps.length
    ? 365 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)
    : 252;
  const mean = daily.length
    ? daily.reduce((a, b) => a + b, 0) / daily.length
    : 0;
  const sd =
    daily.length > 1
      ? Math.sqrt(
          daily.reduce((s, r) => s + (r - mean) ** 2, 0) / (daily.length - 1),
        )
      : 0;
  const enough = daily.length >= 30 && dailyFrequency;
  const volatility = enough ? sd * Math.sqrt(annualFactor) * 100 : null;
  const finalUnit = adjusted.length ? 1 + adjusted.at(-1)!.return / 100 : 0;
  return {
    maxDrawdown: Math.round(maxDrawdown * 1e10) / 1e10,
    volatility,
    cagr:
      days >= 365 && finalUnit > 0
        ? (finalUnit ** (365 / days) - 1) * 100
        : null,
    sharpe:
      enough && sd > 0
        ? (mean * annualFactor - riskFreeRate) / (sd * Math.sqrt(annualFactor))
        : null,
  };
}
export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (
    flows.length < 2 ||
    !flows.some((f) => f.amount > 0) ||
    !flows.some((f) => f.amount < 0)
  )
    return null;
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const first = Date.parse(sorted[0].date);
  const ts = sorted.map((f) => ({
    v: f.amount,
    t: (Date.parse(f.date) - first) / 86400000 / 365,
  }));
  if (
    ts.some((f) => !Number.isFinite(f.t) || !Number.isFinite(f.v)) ||
    ts.at(-1)!.t < 1 / 365
  )
    return null;
  // Conservative: non-conventional flows may have multiple roots, so do not select one arbitrarily.
  const signs = ts.filter((f) => f.v !== 0).map((f) => Math.sign(f.v));
  if (signs.slice(1).filter((s, i) => s !== signs[i]).length > 1) return null;
  const npv = (r: number) => ts.reduce((s, f) => s + f.v / (1 + r) ** f.t, 0);
  let lo = -0.9999,
    hi = 1;
  while (npv(lo) * npv(hi) > 0 && hi < 1e6) hi *= 2;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-8) return mid;
    if (npv(lo) * v < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
/** Rebuild using only transactions that existed at each date, native cash balances and historical FX. */
export function reconstructHistory(
  transactions: Transaction[],
  valuations: {
    date: string;
    prices: Record<string, number>;
    USDINR: number;
  }[],
): HistoryPoint[] {
  const tx = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const positions = new Map<string, { quantity: number; currency: Currency }>();
  const cash: Record<Currency, number> = { INR: 0, USD: 0 };
  let cursor = 0,
    invested = 0;
  return [...valuations]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      let netFlow = 0;
      while (
        cursor < tx.length &&
        tx[cursor].date.slice(0, 10) <= day.date.slice(0, 10)
      ) {
        const t = tx[cursor++];
        const amount = Math.abs(t.amount);
        const pos = t.securityId
          ? positions.get(t.securityId) || { quantity: 0, currency: t.currency }
          : undefined;
        switch (t.type) {
          case "Deposit":
            cash[t.currency] += amount;
            netFlow += convert(amount, t.currency, "INR", day.USDINR);
            break;
          case "Withdrawal":
            cash[t.currency] -= amount;
            netFlow -= convert(amount, t.currency, "INR", day.USDINR);
            break;
          case "Buy":
          case "MF purchase":
            if (!pos || !t.securityId)
              throw new Error("Purchase requires a security");
            pos.quantity += t.quantity;
            cash[t.currency] -= amount;
            positions.set(t.securityId, pos);
            break;
          case "Sell":
          case "MF redemption":
            if (!pos || !t.securityId || pos.quantity < t.quantity)
              throw new Error("Sale exceeds historical position");
            pos.quantity -= t.quantity;
            cash[t.currency] += amount;
            positions.set(t.securityId, pos);
            break;
          case "Split":
            if (!pos || !t.securityId || !t.splitRatio || t.splitRatio <= 0)
              throw new Error("Invalid split");
            pos.quantity *= t.splitRatio;
            positions.set(t.securityId, pos);
            break;
          case "Dividend":
            cash[t.currency] += amount;
            break;
          case "Fee":
          case "Tax":
            cash[t.currency] -= amount;
            break;
        }
      }
      invested += netFlow;
      let value = cash.INR + convert(cash.USD, "USD", "INR", day.USDINR);
      for (const [id, p] of positions) {
        if (!p.quantity) continue;
        const price = day.prices[id];
        if (!Number.isFinite(price) || price < 0)
          throw new Error(`Missing historical price for ${id} on ${day.date}`);
        value += convert(p.quantity * price, p.currency, "INR", day.USDINR);
      }
      if (cash.INR < -0.01 || cash.USD < -0.01)
        throw new Error(
          "Incomplete cash history: a purchase or withdrawal exceeds available cash.",
        );
      return { date: day.date, value, invested, netFlow };
    });
}
