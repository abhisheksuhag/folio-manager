import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Holding, Security } from '../../shared/types.ts';
import { colorFor } from './live.ts';

const BINANCE_URL = 'https://api.binance.com';
/** Assets that are dollar-pegged, so no USDT pair exists to price them. */
const STABLE = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI']);
/** Below this dollar value a balance is dust and only clutters the portfolio. */
const DUST_USD = 1;

export interface BinanceCredentials { apiKey: string; apiSecret: string }

/** Binance error code for a timestamp outside recvWindow, i.e. local clock drift. */
const TIMESTAMP_OUT_OF_WINDOW = -1021;
/** Binance time minus local time. A drifted PC clock otherwise fails every signed call. */
let clockOffsetMs: number | null = null;

async function syncClock(): Promise<void> {
  try {
    const started = Date.now();
    const response = await fetch(`${BINANCE_URL}/api/v3/time`, { signal: AbortSignal.timeout(10_000) });
    const { serverTime } = z.object({ serverTime: z.number() }).parse(await response.json());
    // Assume the server stamped the reply halfway through the round trip.
    clockOffsetMs = serverTime - Math.round((started + Date.now()) / 2);
  } catch {
    clockOffsetMs ??= 0;
  }
}

/**
 * Binance signs the whole query string with HMAC-SHA256 and reads the key from a
 * header. Only read endpoints are used here - this integration never places,
 * modifies or cancels an order, and a key created with "Enable Reading" alone is
 * sufficient.
 */
function signedUrl(path: string, params: Record<string, string>, secret: string): string {
  const timestamp = Date.now() + (clockOffsetMs ?? 0);
  const query = new URLSearchParams({ ...params, timestamp: String(timestamp), recvWindow: '10000' }).toString();
  const signature = createHmac('sha256', secret).update(query).digest('hex');
  return `${BINANCE_URL}${path}?${query}&signature=${signature}`;
}

async function signedGet(path: string, params: Record<string, string>, credentials: BinanceCredentials, timeoutMs = 15_000, retried = false): Promise<unknown> {
  if (clockOffsetMs === null) await syncClock();
  const response = await fetch(signedUrl(path, params, credentials.apiSecret), {
    headers: { 'X-MBX-APIKEY': credentials.apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null) as { code?: number; msg?: string } | null;
  // The clock can drift again while the server runs; resync once and retry.
  if (!response.ok && payload?.code === TIMESTAMP_OUT_OF_WINDOW && !retried) {
    await syncClock();
    return signedGet(path, params, credentials, timeoutMs, true);
  }
  if (!response.ok) {
    // Binance reports auth and permission problems in a JSON body with its own code.
    const detail = payload?.msg ? `${payload.msg}${payload.code ? ` (code ${payload.code})` : ''}` : `HTTP ${response.status}`;
    throw new Error(`Binance rejected the request: ${detail}`);
  }
  return payload;
}

const balanceSchema = z.object({ asset: z.string().min(1).max(24), free: z.coerce.number().nonnegative(), locked: z.coerce.number().nonnegative() }).passthrough();
const accountSchema = z.object({ balances: z.array(balanceSchema).default([]) }).passthrough();
const tickerSchema = z.object({ symbol: z.string(), lastPrice: z.coerce.number().nonnegative(), prevClosePrice: z.coerce.number().nonnegative() }).passthrough();

/** Confirms the credentials work and can read balances, without importing anything. */
export async function verifyBinanceCredentials(credentials: BinanceCredentials): Promise<void> {
  const payload = await signedGet('/api/v3/account', { omitZeroBalances: 'true' }, credentials);
  accountSchema.parse(payload);
}

/** Spot balances priced against USDT. */
export async function fetchBinanceHoldings(credentials: BinanceCredentials): Promise<Array<Omit<Holding, 'id'>>> {
  const account = accountSchema.parse(await signedGet('/api/v3/account', { omitZeroBalances: 'true' }, credentials));
  const owned = account.balances
    .map((row) => ({ asset: row.asset.toUpperCase(), quantity: row.free + row.locked }))
    .filter((row) => row.quantity > 0);
  if (!owned.length) return [];

  const priced = owned.filter((row) => !STABLE.has(row.asset));
  const tickers = new Map<string, { price: number; previous: number }>();
  if (priced.length) {
    const symbols = priced.map((row) => `${row.asset}USDT`);
    const url = `${BINANCE_URL}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    // A symbol that does not trade against USDT makes the whole batch fail, so fall
    // back to the unfiltered ticker list rather than dropping every price.
    const raw = response.ok
      ? await response.json()
      : await (await fetch(`${BINANCE_URL}/api/v3/ticker/24hr`, { signal: AbortSignal.timeout(25_000) })).json();
    for (const item of Array.isArray(raw) ? raw : []) {
      const parsed = tickerSchema.safeParse(item);
      if (parsed.success) tickers.set(parsed.data.symbol, { price: parsed.data.lastPrice, previous: parsed.data.prevClosePrice });
    }
  }

  const rows: Array<Omit<Holding, 'id'>> = [];
  for (const row of owned) {
    const stable = STABLE.has(row.asset);
    const quote = stable ? { price: 1, previous: 1 } : tickers.get(`${row.asset}USDT`);
    // No USDT market means no honest dollar value; skip rather than invent one.
    if (!quote || !(quote.price > 0)) continue;
    if (row.quantity * quote.price < DUST_USD) continue;
    const security: Security = {
      id: `global:binance:${row.asset.toLowerCase()}`,
      ticker: row.asset,
      name: row.asset,
      exchange: 'Binance',
      currency: 'USD',
      country: 'GLOBAL',
      assetClass: 'Crypto',
      sector: 'Digital assets',
      color: colorFor(row.asset),
      price: quote.price,
      previousClose: quote.previous > 0 ? quote.previous : quote.price,
      indices: [],
      asOf: new Date().toISOString(),
      source: 'Binance spot balances',
    };
    // Binance balances carry no cost basis; deriving one needs full trade history,
    // so average price mirrors the market and P&L reads as zero rather than wrong.
    rows.push({ security, broker: 'Binance', accountId: 'binance-spot', quantity: row.quantity, averagePrice: quote.price });
  }
  return rows;
}
