import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app.ts';
import type { AppOptions } from '../server/config.ts';
import type { Store } from '../server/db.ts';
import { alphaSearch, alphaStock, fetchUpstoxHoldings } from '../server/providers/live.ts';
import { openToken, sealToken } from '../server/security.ts';

type RequestInitWithJson = Omit<RequestInit, 'body'> & { body?: unknown };

const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function startServer(overrides: AppOptions = {}) {
  const app = createApp({
    databasePath: ':memory:',
    appOrigin: 'http://127.0.0.1',
    tokenEncryptionKey: testKey,
    environment: 'test',
    ...overrides,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return { app, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

class ApiClient {
  cookie = '';
  csrfToken = '';

  constructor(private readonly baseUrl: string) {}

  async request(path: string, init: RequestInitWithJson = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    if (this.csrfToken && !['GET', 'HEAD'].includes(init.method ?? 'GET')) {
      headers.set('x-csrf-token', this.csrfToken);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';', 1)[0];
    return response;
  }

  async session() {
    const response = await this.request('/api/session');
    assert.equal(response.status, 200);
    const body = await response.json() as { csrfToken: string; user: { id: string } | null };
    this.csrfToken = body.csrfToken;
    return body;
  }

  async register(email: string, name = 'Test User') {
    await this.session();
    const response = await this.request('/api/auth/register', {
      method: 'POST',
      body: { name, email, password: 'correct horse battery staple' },
    });
    assert.equal(response.status, 200);
    await this.session();
    return response.json() as Promise<{ user: { id: string; email: string } }>;
  }
}

async function close(server: Server) {
  server.close();
  await once(server, 'close');
}

test('registration persists a scrypt password and login creates an authenticated session', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const first = new ApiClient(baseUrl);
    const registered = await first.register('owner@example.com', 'Owner');
    assert.equal(registered.user.email, 'owner@example.com');

    const second = new ApiClient(baseUrl);
    await second.session();
    const bad = await second.request('/api/auth/login', {
      method: 'POST', body: { email: 'owner@example.com', password: 'wrong-password' },
    });
    assert.equal(bad.status, 401);

    const good = await second.request('/api/auth/login', {
      method: 'POST', body: { email: 'owner@example.com', password: 'correct horse battery staple' },
    });
    assert.equal(good.status, 200);
    await second.session();
    const workspace = await second.request('/api/workspace');
    assert.equal(workspace.status, 200);
    assert.equal((await workspace.json() as { user: { id: string } }).user.id, registered.user.id);
  } finally {
    await close(server);
  }
});

test('state-changing requests reject a missing CSRF token', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const client = new ApiClient(baseUrl);
    await client.session();
    client.csrfToken = '';
    const response = await client.request('/api/auth/demo', { method: 'POST', body: {} });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Invalid CSRF token' });
  } finally {
    await close(server);
  }
});

test('watchlists are isolated by user ownership', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const owner = new ApiClient(baseUrl);
    const stranger = new ApiClient(baseUrl);
    await owner.register('one@example.com');
    await stranger.register('two@example.com');

    const created = await owner.request('/api/watchlists', { method: 'POST', body: { name: 'Private' } });
    assert.equal(created.status, 200);
    const { watchlist } = await created.json() as { watchlist: { id: string } };

    const crossUser = await stranger.request(`/api/watchlists/${watchlist.id}`, {
      method: 'PATCH', body: { name: 'Stolen' },
    });
    assert.equal(crossUser.status, 404);
    assert.deepEqual(await crossUser.json(), { error: 'Watchlist not found' });
  } finally {
    await close(server);
  }
});

test('broker tokens use authenticated encryption and reject tampering', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const sealed = sealToken('secret-upstream-token', key);
  assert.equal(sealed.includes('secret-upstream-token'), false);
  assert.equal(openToken(sealed, key), 'secret-upstream-token');
  const parts = sealed.split('.');
  parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
  assert.throws(() => openToken(parts.join('.'), key));
});

test('CSV imports validate every row before writing and de-duplicate transactions', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const client = new ApiClient(baseUrl);
    await client.register('importer@example.com');

    const invalidHoldings = [
      'ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf',
      'AAPL,Apple,NASDAQ,USD,US,US equity,Technology,nope,150,200,198,2026-09-04',
    ].join('\n');
    const invalid = await client.request('/api/import', {
      method: 'POST', body: { csv: invalidHoldings, broker: 'Manual', kind: 'holdings' },
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json() as { error: string }).error, /row 2/i);

    const transactions = [
      'id,date,ticker,name,broker,accountId,type,quantity,price,amount,currency',
      ',2026-09-01,AAPL,Apple,Manual,main,Buy,2,200,400,USD',
    ].join('\n');
    const first = await client.request('/api/import', {
      method: 'POST', body: { csv: transactions, broker: 'Manual', kind: 'transactions' },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { imported: 1 });
    const duplicate = await client.request('/api/import', {
      method: 'POST', body: { csv: transactions, broker: 'Manual', kind: 'transactions' },
    });
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { imported: 0 });
  } finally {
    await close(server);
  }
});

test('registered workspaces and search never fall back to demo market data', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const client = new ApiClient(baseUrl);
    await client.register('live@example.com');
    const workspaceResponse = await client.request('/api/workspace');
    const workspace = await workspaceResponse.json() as {
      mode: string; holdings: unknown[]; securities: unknown[]; capabilities: { marketData: boolean };
    };
    assert.equal(workspace.mode, 'live');
    assert.deepEqual(workspace.holdings, []);
    assert.deepEqual(workspace.securities, []);
    assert.equal(workspace.capabilities.marketData, false);

    const search = await client.request('/api/search?q=AAPL');
    assert.deepEqual(await search.json(), { securities: [], indices: [] });
  } finally {
    await close(server);
  }
});

function holdingsCsv(price: number, ticker = 'AAPL', extra = '') {
  return [
    'ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf',
    `${ticker},Apple,NASDAQ,USD,US,US equity,Technology,1,150,${price},${price - 1},2026-09-04${extra}`,
  ].join('\n');
}

test('security quotes and index memberships are isolated per user', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const first = new ApiClient(baseUrl); const second = new ApiClient(baseUrl);
    await first.register('security-one@example.com'); await second.register('security-two@example.com');
    for (const [client, price] of [[first, 200], [second, 999]] as const) {
      const response = await client.request('/api/import', { method: 'POST', body: { csv: holdingsCsv(price), broker: 'Manual', kind: 'holdings' } });
      assert.equal(response.status, 200);
    }
    const constituents = 'index,ticker,name,exchange,currency,country,sector,assetClass\nPRIVATE500,AAPL,Apple,NASDAQ,USD,US,Technology,US equity\n';
    assert.equal((await first.request('/api/import', { method: 'POST', body: { csv: constituents, broker: 'Manual', kind: 'constituents' } })).status, 200);
    const one = await (await first.request('/api/workspace')).json() as { securities: Array<{ price: number; indices: string[] }> };
    const two = await (await second.request('/api/workspace')).json() as { securities: Array<{ price: number; indices: string[] }> };
    assert.equal(one.securities[0].price, 200); assert.deepEqual(one.securities[0].indices, ['PRIVATE500']);
    assert.equal(two.securities[0].price, 999); assert.deepEqual(two.securities[0].indices, []);
  } finally { await close(server); }
});

test('INDmoney OAuth connection state remains isolated per user', async () => {
  const { app, server, baseUrl } = await startServer({ indmoneyMcpUrl: 'https://mcp.example.test', indmoneyRedirectUri: 'http://127.0.0.1/auth/callback' });
  try {
    const owner = new ApiClient(baseUrl); const other = new ApiClient(baseUrl);
    const first = await owner.register('owner@example.com'); const second = await other.register('other@example.com');
    const store = app.locals.store as Store;
    store.ensureConnection(first.user.id, 'INDmoney', ['read holdings']);
    assert.ok(store.connection(first.user.id, 'INDmoney'));
    assert.equal(store.connection(second.user.id, 'INDmoney'), null);
    const workspace = await (await other.request('/api/workspace')).json() as { capabilities: { indmoney: boolean }; connections: unknown[] };
    assert.equal(workspace.capabilities.indmoney, true);
    assert.deepEqual(workspace.connections, []);
    const sync = await other.request('/api/connections/indmoney/sync', { method: 'POST', body: {} });
    assert.equal(sync.status, 409);
    assert.match((await sync.json() as { error: string }).error, /connect INDmoney/i);
  } finally { await close(server); }
});

test('provider transaction ids are de-duplicated per user and broker', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const first = new ApiClient(baseUrl); const second = new ApiClient(baseUrl);
    await first.register('tx-one@example.com'); await second.register('tx-two@example.com');
    const csv = 'id,date,securityId,ticker,name,broker,accountId,type,quantity,price,amount,currency,splitRatio\nprovider-42,2026-09-01,,AAPL,Apple,Manual,main,Buy,1,200,200,USD,\n';
    for (const client of [first, second]) {
      const response = await client.request('/api/import', { method: 'POST', body: { csv, broker: 'Manual', kind: 'transactions' } });
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { imported: 1 });
    }
  } finally { await close(server); }
});

test('Upstox accepts only a strict success envelope and preserves a prior snapshot on provider errors', async () => {
  const originalFetch = globalThis.fetch;
  // Keep local API requests real while replacing only the external provider.
  const mock = (payload: unknown) => { globalThis.fetch = async (input, init) => String(input).startsWith('http://127.0.0.1:') ? originalFetch(input, init) : new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    for (const payload of [{ status: 'error', errors: [] }, { status: 'success' }, { status: 'success', data: [{ trading_symbol: 'BAD' }] }]) {
      mock(payload); await assert.rejects(() => fetchUpstoxHoldings('token'));
    }
    mock({ status: 'success', data: [] }); assert.deepEqual(await fetchUpstoxHoldings('token'), []);

    const { app, server, baseUrl } = await startServer();
    try {
      const client = new ApiClient(baseUrl); const registered = await client.register('upstox@example.com');
      await client.request('/api/import', { method: 'POST', body: { csv: holdingsCsv(200), broker: 'Upstox', kind: 'holdings' } });
      const store = app.locals.store as Store; const id = `${registered.user.id}:upstox`;
      store.upsertConnection(registered.user.id, 'Upstox', 'oauth'); store.saveBrokerToken(id, sealToken('upstream-token', testKey));
      mock({ status: 'error', errors: [{ message: 'temporary' }] });
      const sync = await client.request('/api/connections/upstox/sync', { method: 'POST', body: {} });
      assert.equal(sync.status, 502);
      const workspace = await (await client.request('/api/workspace')).json() as { holdings: Array<{ security: { price: number } }> };
      assert.equal(workspace.holdings[0].security.price, 200);
    } finally { await close(server); }
  } finally { globalThis.fetch = originalFetch; }
});

test('missing FX is explicit and INR aggregate analysis refuses to calculate', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const client = new ApiClient(baseUrl); await client.register('fx@example.com');
    await client.request('/api/import', { method: 'POST', body: { csv: holdingsCsv(200), broker: 'Manual', kind: 'holdings' } });
    const workspace = await (await client.request('/api/workspace')).json() as { fx: { USDINR: number | null; asOf: string; source: string } };
    assert.equal(workspace.fx.USDINR, 0); assert.equal(workspace.fx.asOf, ''); assert.match(workspace.fx.source, /unavailable/i);
    const response = await client.request('/api/analysis', { method: 'POST', body: { question: 'Show my allocation and concentration' } });
    const result = await response.json() as { message: { content: string; sources: string[] } };
    assert.match(result.message.content, /cannot calculate/i); assert.match(result.message.sources.join(' '), /unavailable/i);
  } finally { await close(server); }
});

test('CSV holdings reject impossible dates, unsafe ids, zero quotes, and country/currency mismatches', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const client = new ApiClient(baseUrl); await client.register('csv-rules@example.com');
    const rows = [
      'AAPL,Apple,NASDAQ,INR,US,US equity,Technology,1,150,200,199,2026-09-04',
      'AAPL,Apple,NASDAQ,USD,US,US equity,Technology,1,150,200,199,2026-99-99',
      'AAPL:BAD,Apple,NASDAQ,USD,US,US equity,Technology,1,150,200,199,2026-09-04',
      'AAPL,Apple,NASDAQ,USD,US,US equity,Technology,1,150,0,199,2026-09-04',
    ];
    const header = 'ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf';
    for (const row of rows) {
      const response = await client.request('/api/import', { method: 'POST', body: { csv: `${header}\n${row}\n`, broker: 'Manual', kind: 'holdings' } });
      assert.equal(response.status, 400);
    }
  } finally { await close(server); }
});

test('Alpha Vantage uses an honest exchange, trading date, yield units, and no invented annual period', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); const fn = url.searchParams.get('function');
    const payload = fn === 'SYMBOL_SEARCH' ? { bestMatches: [{ '1. symbol': 'AAPL', '2. name': 'Apple', '3. type': 'Equity', '4. region': 'United States', '8. currency': 'USD' }] }
      : fn === 'GLOBAL_QUOTE' ? { 'Global Quote': { '01. symbol': 'AAPL', '05. price': '200', '08. previous close': '198', '07. latest trading day': '2026-09-04' } }
      : fn === 'TIME_SERIES_DAILY' ? { 'Time Series (Daily)': {} }
      : { Symbol: 'AAPL', Sector: 'Technology', DividendYield: '0.0045', EPS: '6.5' };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try {
    const matches = await alphaSearch(null, 'AAPL', 'key'); assert.equal(matches[0].exchange, 'UNKNOWN'); assert.equal(matches[0].id, 'us:unknown:aapl');
    const stock = await alphaStock(null, matches[0], 'key'); assert.equal(stock.security.asOf, '2026-09-04'); assert.equal(stock.security.dividendYield, 0.45); assert.deepEqual(stock.fundamentals.periods, []);
  } finally { globalThis.fetch = originalFetch; }
});

test('portfolio mutation lock orders sync before a newer CSV import and constituents mark CSV metadata', async () => {
  const originalFetch = globalThis.fetch; let release!: () => void; let started!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { started = resolve; });
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    started(); await new Promise<void>((resolve) => { release = resolve; });
    return new Response(JSON.stringify({ status: 'success', data: [{ trading_symbol: 'AAPL', exchange: 'NASDAQ', quantity: 1, average_price: 150, last_price: 100, close_price: 99 }] }), { status: 200 });
  };
  const { app, server, baseUrl } = await startServer();
  try {
    const client = new ApiClient(baseUrl); const registered = await client.register('locking@example.com'); const store = app.locals.store as Store;
    store.upsertConnection(registered.user.id, 'Upstox', 'oauth'); store.saveBrokerToken(`${registered.user.id}:upstox`, sealToken('token', testKey));
    const sync = client.request('/api/connections/upstox/sync', { method: 'POST', body: {} }); await fetchStarted;
    const csvImport = client.request('/api/import', { method: 'POST', body: { csv: holdingsCsv(999), broker: 'Upstox', kind: 'holdings' } });
    const completedBeforeRelease = await Promise.race([csvImport.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 100))]);
    assert.equal(completedBeforeRelease, false); release(); assert.equal((await sync).status, 200); assert.equal((await csvImport).status, 200);
    const workspace = await (await client.request('/api/workspace')).json() as { holdings: Array<{ security: { price: number } }>; connections: Array<{ broker: string; method: string }> };
    assert.equal(workspace.holdings[0].security.price, 999);
    const constituents = 'index,ticker,name,exchange,currency,country,sector,assetClass\nSP500,AAPL,Apple,NASDAQ,USD,US,Technology,US equity\n';
    await client.request('/api/import', { method: 'POST', body: { csv: constituents, broker: 'Manual', kind: 'constituents' } });
    const after = await (await client.request('/api/workspace')).json() as { connections: Array<{ broker: string; method: string }> };
    assert.equal(after.connections.find((item) => item.broker === 'Manual')?.method, 'csv');
  } finally { release?.(); globalThis.fetch = originalFetch; await close(server); }
});
