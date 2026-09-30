import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { z } from 'zod';
import type { FundComposition, Fundamentals, HistoryPoint, Holding, Security } from '../../shared/types.ts';
import type { Store } from '../db.ts';
import { openToken, sealToken } from '../security.ts';
import { colorFor } from './live.ts';

export const INDMONEY_MCP_URL = 'https://mcp.indmoney.com/mcp';
const SCOPE = 'portfolio:read';

/**
 * INDmoney's MCP server is a standard OAuth 2.0 protected resource that supports
 * Dynamic Client Registration, so there is nothing to pre-register by hand: the
 * SDK registers this deployment on first use and stores the issued credentials on
 * the connection row. Tokens are sealed with TOKEN_ENCRYPTION_KEY at rest.
 *
 * One provider instance serves one user's connection - tokens, the PKCE verifier
 * and the client registration must never cross connections.
 */
export class ConnectionOAuthProvider implements OAuthClientProvider {
  /** Set when the SDK wants an interactive redirect rather than a silent refresh. */
  authorizationUrl?: URL;

  constructor(
    private readonly store: Store,
    private readonly connectionId: string,
    private readonly redirectUri: string,
    private readonly encryptionKey: string,
  ) {}

  get redirectUrl(): string { return this.redirectUri; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Folio',
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: SCOPE,
    };
  }

  private row(): Record<string, unknown> {
    const row = this.store.connectionById(this.connectionId);
    if (!row) throw new Error('Connection no longer exists');
    return row;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const raw = this.row().oauth_client_json;
    if (!raw) return undefined;
    return JSON.parse(openToken(String(raw), this.encryptionKey)) as OAuthClientInformationMixed;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.store.saveOAuthClient(this.connectionId, sealToken(JSON.stringify(clientInformation), this.encryptionKey));
  }

  tokens(): OAuthTokens | undefined {
    const row = this.row();
    if (!row.encrypted_token) return undefined;
    const expiresAt = row.token_expires_at ? Date.parse(String(row.token_expires_at)) : undefined;
    return {
      access_token: openToken(String(row.encrypted_token), this.encryptionKey),
      token_type: 'Bearer',
      scope: SCOPE,
      ...(row.encrypted_refresh_token ? { refresh_token: openToken(String(row.encrypted_refresh_token), this.encryptionKey) } : {}),
      // The SDK only needs a positive remaining lifetime; it refreshes on 401 regardless.
      ...(expiresAt && Number.isFinite(expiresAt) ? { expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) } : {}),
    };
  }

  saveTokens(tokens: OAuthTokens): void {
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : undefined;
    // A refresh response may omit refresh_token; keep the one already stored in that case.
    const existing = this.row().encrypted_refresh_token;
    const refresh = tokens.refresh_token ? sealToken(tokens.refresh_token, this.encryptionKey) : existing ? String(existing) : null;
    this.store.saveBrokerTokens(this.connectionId, sealToken(tokens.access_token, this.encryptionKey), refresh, expiresAt);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Server-side flow: capture the URL and hand it to the browser via the route.
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.saveOAuthVerifier(this.connectionId, sealToken(codeVerifier, this.encryptionKey));
  }

  codeVerifier(): string {
    const raw = this.row().oauth_verifier;
    if (!raw) throw new Error('Missing PKCE verifier; restart the INDmoney connection');
    return openToken(String(raw), this.encryptionKey);
  }

  state(): string {
    // The connection id is the state: the callback needs it to reload this provider,
    // and consumeOAuthState still verifies the hash it stored at /connect time.
    return this.stateValue ?? '';
  }

  stateValue?: string;
}

export interface IndmoneyAuthOptions {
  store: Store;
  connectionId: string;
  redirectUri: string;
  encryptionKey: string;
  serverUrl: string;
  /** Brokers already connected directly, whose rows INDmoney should not duplicate. */
  excludeBrokers?: string[];
}

/**
 * Starts the handshake: discovers metadata, registers the client if needed, and
 * returns the URL the browser must visit. Returns null when existing tokens are
 * still usable (nothing to authorize).
 */
export async function beginIndmoneyAuth(options: IndmoneyAuthOptions, state: string): Promise<string | null> {
  const provider = new ConnectionOAuthProvider(options.store, options.connectionId, options.redirectUri, options.encryptionKey);
  provider.stateValue = state;
  const result = await auth(provider, { serverUrl: options.serverUrl, scope: SCOPE });
  if (result === 'AUTHORIZED') return null;
  if (!provider.authorizationUrl) throw new Error('INDmoney did not return an authorization URL');
  return provider.authorizationUrl.toString();
}

/** Completes the handshake by exchanging the authorization code for tokens. */
export async function completeIndmoneyAuth(options: IndmoneyAuthOptions, authorizationCode: string): Promise<void> {
  const provider = new ConnectionOAuthProvider(options.store, options.connectionId, options.redirectUri, options.encryptionKey);
  const result = await auth(provider, { serverUrl: options.serverUrl, authorizationCode, scope: SCOPE });
  if (result !== 'AUTHORIZED') throw new Error('INDmoney authorization did not complete');
}

/**
 * INDmoney's tools are LLM-facing: every one declares `outputSchema` {result: string},
 * and `result` carries a JSON document as text. Errors come back through the same
 * channel as plain prose (e.g. "Error executing tool ..."), so a parse failure is
 * reported verbatim rather than as a generic message.
 */
const indHolding = z.object({
  // A retirement balance has no instrument code, unit count or unit price - only
  // an amount - so these three are nullable and the mapping treats such a row as
  // a single position valued at its balance.
  investment_code: z.string().min(1).max(60).nullable().optional(),
  investment: z.string().min(1).max(200),
  total_units: z.coerce.number().positive().nullable().optional(),
  unit_price: z.coerce.number().nonnegative().nullable().optional(),
  invested_amount: z.coerce.number().nonnegative(),
  market_value: z.coerce.number().nonnegative(),
  one_day_change: z.coerce.number().default(0),
  broker: z.string().max(80).nullable().optional(),
  // Present on US_STOCK only: native-currency figures alongside the INR conversion.
  invested_value_usd: z.coerce.number().nonnegative().optional(),
  current_value_usd: z.coerce.number().nonnegative().optional(),
  one_day_change_usd: z.coerce.number().optional(),
}).passthrough();

function brokerIdentity(name:string):string {
  const normalized=name.trim().toLowerCase().replace(/[\s._-]+/g,'');
  return /^upstox(?:securities)?(?:(?:pvt|private)(?:ltd|limited)|ltd|limited)?$/.test(normalized)?'upstox':normalized;
}

/** Upstox is always sourced directly, never through INDmoney's linked accounts. */
export function parseIndmoneyHoldingRows(assetType:string,payload:{holdings?:unknown},excludeBrokers:string[]=[]) {
  if(!Array.isArray(payload.holdings))throw new Error(`INDmoney returned no holdings list for ${assetType}`);
  const excluded=new Set(['upstox',...excludeBrokers.map(brokerIdentity)]);
  return payload.holdings.map(item=>indHolding.parse(item)).filter(row=>!(row.broker&&excluded.has(brokerIdentity(row.broker))));
}

const ASSET_TYPES = [
  { assetType: 'IND_STOCK', country: 'IN', currency: 'INR', assetClass: 'Indian equity', unitised: true },
  { assetType: 'US_STOCK', country: 'US', currency: 'USD', assetClass: 'US equity', unitised: true },
  { assetType: 'MF', country: 'IN', currency: 'INR', assetClass: 'Mutual fund', unitised: true },
  { assetType: 'EPF', country: 'IN', currency: 'INR', assetClass: 'Retirement', unitised: false },
] as const;

/** A stable id segment for a balance that has no instrument code. */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'account';
}

const HOLDINGS_TOOL = 'networth_holdings';
const FUND_DETAILS_TOOL = 'get_mf_funds_details';

type JsonSchema={type?:unknown;properties?:unknown;required?:unknown};

/** Selects only known identifier fields from the tool's declared input schema. */
export function indmoneyFundArguments(schema:JsonSchema,fundCode:string):Record<string,unknown> {
  const properties=schema.properties&&typeof schema.properties==='object'?schema.properties as Record<string,unknown>:{};
  const required=Array.isArray(schema.required)?schema.required:[];
  for(const name of ['ind_keys','mf_keys','fund_ids','fund_code','ind_key'] as const) {
    const field=properties[name] as {type?:string;items?:{type?:string}}|undefined;
    if(!field)continue;
    if(required.some(key=>key!==name))throw new Error('Fund lookup requires unsupported arguments');
    const array=['ind_keys','mf_keys','fund_ids'].includes(name);
    if(array&&field.type==='array'&&field.items?.type==='string')return {[name]:[fundCode]};
    if(!array&&field.type==='string')return {[name]:fundCode};
  }
  throw new Error(`${FUND_DETAILS_TOOL} exposes no supported read-only fund identifier`);
}

const percentage=z.coerce.number().min(0).max(100);
const fundHolding=z.object({security_name:z.string().trim().min(1).max(300),symbol:z.string().trim().max(50).optional(),isin:z.string().trim().max(30).optional(),percentage_to_nav:percentage,sector:z.string().trim().max(120).optional(),country:z.string().trim().max(80).optional(),asset_class:z.string().trim().max(80).optional()}).strict();
const fundAllocation=z.object({name:z.string().trim().min(1).max(120),percentage}).strict();
const fundDetails=z.object({scheme_name:z.string().trim().min(1).max(300),aum:z.coerce.number().positive().optional(),expense_ratio:percentage.optional(),benchmark:z.string().trim().max(200).optional(),category:z.string().trim().max(160).optional(),portfolio_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),holdings:z.array(fundHolding).min(1),sector_allocation:z.array(fundAllocation).optional(),country_allocation:z.array(fundAllocation).optional(),asset_allocation:z.array(fundAllocation).optional(),reported_holding_count:z.coerce.number().int().positive().optional()}).strict();

/** Accept only this explicit payload shape. Unknown provider revisions remain unavailable. */
export function parseIndmoneyFundCompositionPayload(payload:unknown,fetchedAt=new Date().toISOString()):FundComposition {
  const parsed=fundDetails.safeParse(payload);
  if(!parsed.success) throw new Error('INDmoney returned an unrecognized fund composition payload');
  if(parsed.data.portfolio_date&&(!Number.isFinite(Date.parse(parsed.data.portfolio_date))||new Date(parsed.data.portfolio_date).toISOString().slice(0,10)!==parsed.data.portfolio_date)) throw new Error('INDmoney returned an invalid portfolio date');
  const holdings=parsed.data.holdings.map((item)=>({name:item.security_name,...(item.symbol?{ticker:item.symbol.toUpperCase()}:{}),...(item.isin?{isin:item.isin}:{}),weight:item.percentage_to_nav,...(item.sector?{sector:item.sector}:{}),...(item.country?{country:item.country}:{}),...(item.asset_class?{assetClass:item.asset_class}:{})}));
  const allocations=(items:typeof parsed.data.sector_allocation)=>items?.map((item)=>({name:item.name,weight:item.percentage}))??[];
  const total=holdings.reduce((sum,item)=>sum+item.weight,0);
  const reportedHoldingCount=parsed.data.reported_holding_count??holdings.length;
  const partial=total<99.5||total>100.5||reportedHoldingCount>holdings.length;
  return {status:partial?'partial':'available',holdings,sectors:allocations(parsed.data.sector_allocation),countries:allocations(parsed.data.country_allocation),assetAllocation:allocations(parsed.data.asset_allocation),asOf:parsed.data.portfolio_date??null,fetchedAt,source:'INDmoney MCP get_mf_funds_details',reportedHoldingCount,...(parsed.data.expense_ratio===undefined?{}:{expenseRatio:parsed.data.expense_ratio}),...(parsed.data.aum===undefined?{}:{aum:parsed.data.aum}),...(parsed.data.benchmark?{benchmark:parsed.data.benchmark}:{}),...(parsed.data.category?{category:parsed.data.category}:{}),...(partial?{reason:`Published holdings cover ${total.toFixed(2)}%; the remainder is not normalized.`}:{})};
}

export function selectIndmoneyFundPayload(payload:unknown,fundCode:string,schemeName:string):unknown {
  if(!payload||typeof payload!=='object')throw new Error('Fund identity could not be verified');
  const data=payload as Record<string,unknown>;
  if(data[fundCode]&&typeof data[fundCode]==='object')return data[fundCode];
  const candidate=(data.fund_details??data) as Record<string,unknown>;
  const canonical=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
  if(typeof candidate.scheme_name!=='string'||canonical(candidate.scheme_name)!==canonical(schemeName))throw new Error('Fund identity could not be verified; another scheme was not substituted');
  return candidate;
}

/**
 * INDmoney returns a real ticker only for US stocks; Indian stocks and funds carry
 * internal codes ("INDS01052", "3598") that mean nothing to a reader. For those,
 * show a trimmed version of the instrument name instead of inventing a symbol.
 */
function displayTicker(code: string, name: string, isUsStock: boolean): string {
  if (isUsStock) return code.toUpperCase();
  // Fund names end in plan descriptors ("Direct Plan - Growth Option") that say
  // nothing about the instrument. Peel them off the tail, however they're punctuated.
  let label = name.replace(/\s+/g, ' ').trim();
  const suffix = /[\s,\-\u2013]*\b(direct|regular|growth|dividend|idcw|payout|reinvestment|plan|option)\b[\s,\-\u2013]*$/i;
  let previous = '';
  while (label !== previous && suffix.test(label)) {
    previous = label;
    label = label.replace(suffix, '').trim();
  }
  label = (label || name).replace(/[\s\-\u2013,]+$/, '').trim();
  return label.length > 32 ? `${label.slice(0, 31).trimEnd()}\u2026` : label;
}

/** Reads the JSON document INDmoney returns as a string, surfacing provider prose as-is. */
function parseToolResult(assetType: string, result: unknown): { holdings?: unknown } {
  const structured = (result as { structuredContent?: { result?: unknown } }).structuredContent?.result;
  const content = (result as { content?: unknown }).content;
  const block = Array.isArray(content)
    ? content.find((item): item is { type: 'text'; text: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'text')
    : undefined;
  const raw = typeof structured === 'string' ? structured : block?.text;
  if (typeof raw !== 'string') throw new Error(`INDmoney returned no readable result for ${assetType}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON means INDmoney sent a message instead of data - show it.
    throw new Error(`INDmoney could not return ${assetType} holdings: ${raw.slice(0, 300).replace(/\s+/g, ' ').trim()}`);
  }
  // Rate limits and tool errors arrive as a successful JSON body, not an MCP
  // error, so an unchecked result silently looks like "no holdings".
  const failure = (parsed as { error?: unknown; message?: unknown } | null)?.error;
  if (typeof failure === 'string') {
    const detail = (parsed as { message?: unknown }).message;
    throw new Error(`INDmoney refused the ${assetType} request (${failure})${typeof detail === 'string' ? `: ${detail}` : ''}`);
  }
  return parsed as { holdings?: unknown };
}

const SYMBOL_TTL_MS = 30 * 24 * 60 * 60_000;
/** get_indian_stocks_details accepts at most 10 keys per call. */
const DETAIL_BATCH = 10;

/**
 * INDmoney's holdings payload identifies Indian instruments only by internal code
 * ("INDS01052"). get_indian_stocks_details maps those to the real listing symbol
 * and exchange, which is what makes a holding line up with the same stock held at
 * another broker, and what lets a logo be found. Mappings are stable, so they are
 * cached for a month and only unknown codes cost a call.
 */
async function resolveIndianSymbols(client: Client, store: Store, codes: string[]): Promise<Map<string, { symbol: string; exchange: string }>> {
  const resolved = new Map<string, { symbol: string; exchange: string }>();
  const missing: string[] = [];
  for (const code of codes) {
    const hit = store.readCache(`ind:symbol:${code}`);
    const value = hit && !hit.expired ? hit.payload as { symbol?: unknown; exchange?: unknown } : null;
    if (value && typeof value.symbol === 'string' && typeof value.exchange === 'string') resolved.set(code, { symbol: value.symbol, exchange: value.exchange });
    else missing.push(code);
  }
  if (!missing.length) return resolved;
  try {
    // The tool accepts at most 10 keys per call, and 15 calls a minute.
    for (let start = 0; start < missing.length; start += DETAIL_BATCH) {
      const batch = missing.slice(start, start + DETAIL_BATCH);
      const result = await client.callTool({ name: 'get_indian_stocks_details', arguments: { ind_keys: batch } });
      const parsed = parseToolResult('IND_STOCK details', result) as Record<string, unknown>;
      for (const code of batch) {
        const basic = (parsed[code] as { entity_basic?: Record<string, unknown> } | undefined)?.entity_basic;
        const symbol = typeof basic?.symbol === 'string' ? basic.symbol.trim().toUpperCase() : '';
        const exchange = typeof basic?.exchange === 'string' ? basic.exchange.trim().toUpperCase() : '';
        if (!symbol || !exchange) continue;
        store.writeCache(`ind:symbol:${code}`, { symbol, exchange }, 'INDmoney MCP', new Date().toISOString(), SYMBOL_TTL_MS);
        store.writeCache(`ind:bykey:in:${exchange.toLowerCase()}:${symbol.toLowerCase()}`, { indKey: code }, 'INDmoney MCP', new Date().toISOString(), SYMBOL_TTL_MS);
        resolved.set(code, { symbol, exchange });
      }
    }
  } catch (error) {
    // Unresolved codes fall back to the internal code below - a degraded label,
    // not a failed sync - but say why, or the fallback looks like a data problem.
    console.warn('INDmoney symbol resolution failed:', error instanceof Error ? error.message : error);
  }
  return resolved;
}

export async function fetchIndmoneyHoldings(options: IndmoneyAuthOptions): Promise<Array<Omit<Holding, 'id'>>> {
  const url = new URL(options.serverUrl);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('INDMONEY_MCP_URL must use HTTPS (localhost is allowed for development)');
  }
  const provider = new ConnectionOAuthProvider(options.store, options.connectionId, options.redirectUri, options.encryptionKey);
  const transport = new StreamableHTTPClientTransport(url, { authProvider: provider });
  const client = new Client({ name: 'folio-readonly', version: '1.0.0' });
  // Upstox-linked rows are excluded regardless of connector status. Additional
  // directly connected brokers can be excluded by the caller as well.
  const rows: Array<Omit<Holding, 'id'>> = [];
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    if (!listed.tools.some((tool) => tool.name === HOLDINGS_TOOL)) {
      throw new Error(`INDmoney MCP exposes no ${HOLDINGS_TOOL} tool. Tools offered: ${listed.tools.map((tool) => tool.name).join(', ') || 'none'}`);
    }
    for (const spec of ASSET_TYPES) {
      const result = await client.callTool({ name: HOLDINGS_TOOL, arguments: { asset_type: spec.assetType } });
      const parsed = parseToolResult(spec.assetType, result);
      // An account with nothing of this type returns holdings: []. A missing array
      // means the call did not deliver data, and skipping it would understate the
      // portfolio - which then overwrites the stored holdings with less than the truth.
      const kept = parseIndmoneyHoldingRows(spec.assetType,parsed,options.excludeBrokers);
      const symbols = spec.assetType === 'IND_STOCK'
        ? await resolveIndianSymbols(client, options.store, kept.flatMap((row) => row.investment_code ? [row.investment_code] : []))
        : new Map<string, { symbol: string; exchange: string }>();
      for (const row of kept) {
        // Balance-style rows (EPF) are held as a single unit priced at the balance,
        // so value, cost and day change stay correct without inventing a unit count.
        const units = spec.unitised ? row.total_units ?? 0 : 1;
        if (!(units > 0)) continue;
        // US holdings report both an INR conversion and native USD; prefer native.
        const native = spec.currency === 'USD' && row.current_value_usd !== undefined
          ? { value: row.current_value_usd, invested: row.invested_value_usd ?? row.current_value_usd, dayChange: row.one_day_change_usd ?? 0 }
          : { value: row.market_value, invested: row.invested_amount, dayChange: row.one_day_change };
        const price = native.value / units;
        const fallbackCode = row.investment_code ?? slug(row.investment);
        const listed = row.investment_code ? symbols.get(row.investment_code) : undefined;
        const venue = listed?.exchange ?? 'INDmoney';
        const code = listed?.symbol ?? fallbackCode;
        const security: Security = {
          id: `${spec.country.toLowerCase()}:${venue.toLowerCase()}:${code.toLowerCase()}`,
          // A balance has no symbol; the scheme name reads better than the employer.
          ticker: listed ? listed.symbol : spec.unitised ? displayTicker(fallbackCode, row.investment, spec.assetType === 'US_STOCK') : spec.assetType,
          name: row.investment,
          // Falls back to a source label when INDmoney gives no listing venue.
          exchange: venue,
          currency: spec.currency,
          country: spec.country,
          assetClass: spec.assetClass,
          sector: spec.unitised ? 'Unavailable from INDmoney MCP' : 'Retirement savings',
          color: colorFor(code),
          price,
          previousClose: units > 0 ? (native.value - native.dayChange) / units : price,
          indices: [],
          asOf: new Date().toISOString(),
          source: 'INDmoney MCP',
        };
        rows.push({ security, broker: 'INDmoney', accountId: row.broker?.trim()?`indmoney:${brokerIdentity(row.broker)}`:'indmoney', quantity: units, averagePrice: native.invested / units });
      }
    }
    return rows;
  } finally {
    await client.close().catch(() => {});
  }
}

/** Loads one known INDmoney fund by its provider identity; no fuzzy plan lookup. */
export async function fetchIndmoneyFundComposition(options:IndmoneyAuthOptions,security:Security):Promise<FundComposition> {
  const [country,provider,fundCode]=security.id.split(':');
  if(country!=='in'||provider!=='indmoney'||!fundCode) throw new Error('Fund has no INDmoney provider identity; composition lookup was not attempted');
  const url=new URL(options.serverUrl);
  if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1'&&url.hostname!=='localhost') throw new Error('INDMONEY_MCP_URL must use HTTPS (localhost is allowed for development)');
  const providerAuth=new ConnectionOAuthProvider(options.store,options.connectionId,options.redirectUri,options.encryptionKey);
  const transport=new StreamableHTTPClientTransport(url,{authProvider:providerAuth});
  const client=new Client({name:'folio-readonly',version:'1.0.0'});
  try {
    await client.connect(transport);
    const listed=await client.listTools();
    const tool=listed.tools.find((item)=>item.name===FUND_DETAILS_TOOL);
    if(!tool) throw new Error(`INDmoney MCP exposes no ${FUND_DETAILS_TOOL} tool`);
    const args=indmoneyFundArguments(tool.inputSchema as JsonSchema,fundCode);
    const result=await client.callTool({name:FUND_DETAILS_TOOL,arguments:args});
    const parsed=parseToolResult('MF fund details',result) as Record<string,unknown>;
    const payload=selectIndmoneyFundPayload(parsed,fundCode,security.name);
    return parseIndmoneyFundCompositionPayload(payload);
  } finally { await client.close().catch(()=>{}); }
}

const OHLC_TTL_MS = 60 * 60_000;

const ohlcCandle = z.object({
  datetime_ist: z.string().min(4),
  close: z.coerce.number().nonnegative(),
}).passthrough();

const entityStats = z.object({
  live_price: z.coerce.number().nonnegative().optional(),
  prev_close: z.coerce.number().nonnegative().optional(),
  '52week_high': z.coerce.number().nonnegative().optional(),
  '52week_low': z.coerce.number().nonnegative().optional(),
  volume: z.coerce.number().nonnegative().optional(),
  last_updated: z.string().optional(),
}).passthrough();

/**
 * The ind_key for a security id, learned during a holdings sync and otherwise
 * looked up by name. Without one, INDmoney's market tools cannot be addressed.
 */
async function indKeyFor(client: Client, store: Store, security: Security): Promise<string | null> {
  const cacheKey = `ind:bykey:${security.id}`;
  const hit = store.readCache(cacheKey);
  const cached = hit ? (hit.payload as { indKey?: unknown }).indKey : undefined;
  if (typeof cached === 'string' && cached) return cached;
  try {
    const result = await client.callTool({ name: 'lookup_ind_keys', arguments: { names: [security.name], filter_type: 'IN_STOCKS' } });
    const parsed = parseToolResult('lookup', result) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] as { ind_key?: unknown } : null;
    const indKey = typeof first?.ind_key === 'string' ? first.ind_key : null;
    if (indKey) store.writeCache(cacheKey, { indKey }, 'INDmoney MCP', new Date().toISOString(), SYMBOL_TTL_MS);
    return indKey;
  } catch (error) {
    console.warn('INDmoney ind_key lookup failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * A full stock view for an Indian listing, sourced entirely from INDmoney: a year
 * of daily closes plus live stats. Preferred over Alpha Vantage for Indian names -
 * it is NSE rather than BSE, it costs nothing from the 25-call daily budget, and
 * Alpha Vantage has no quote at all for an unsuffixed Indian ticker.
 */
export async function fetchIndianStock(options: IndmoneyAuthOptions, security: Security): Promise<{ security: Security; history: HistoryPoint[]; fundamentals: Fundamentals } | null> {
  const url = new URL(options.serverUrl);
  const provider = new ConnectionOAuthProvider(options.store, options.connectionId, options.redirectUri, options.encryptionKey);
  const client = new Client({ name: 'folio-readonly', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
    const indKey = await indKeyFor(client, options.store, security);
    if (!indKey) return null;

    const ohlcKey = `ind:ohlc:${indKey}`;
    const ohlcHit = options.store.readCache(ohlcKey);
    let candles: unknown;
    if (ohlcHit && !ohlcHit.expired) candles = ohlcHit.payload;
    else {
      const result = await client.callTool({ name: 'get_indian_stocks_ohlc', arguments: { ind_key: indKey, interval: '1day', lookback: '1y' } });
      candles = (parseToolResult('OHLC', result) as { candles?: unknown }).candles;
      if (Array.isArray(candles)) options.store.writeCache(ohlcKey, candles, 'INDmoney MCP', new Date().toISOString(), OHLC_TTL_MS);
    }
    const history: HistoryPoint[] = Array.isArray(candles)
      ? candles.flatMap((item) => {
          const parsed = ohlcCandle.safeParse(item);
          if (!parsed.success || !Number.isFinite(parsed.data.close)) return [];
          return [{ date: parsed.data.datetime_ist.slice(0, 10), value: parsed.data.close, invested: 0, netFlow: 0 }];
        })
      : [];

    const detailsKey = `ind:stats:${indKey}`;
    const detailsHit = options.store.readCache(detailsKey);
    let entry: Record<string, unknown> | null = detailsHit && !detailsHit.expired ? detailsHit.payload as Record<string, unknown> : null;
    if (!entry) {
      const result = await client.callTool({ name: 'get_indian_stocks_details', arguments: { ind_keys: [indKey] } });
      const parsed = parseToolResult('details', result) as Record<string, unknown>;
      entry = (parsed[indKey] as Record<string, unknown>) ?? null;
      if (entry) options.store.writeCache(detailsKey, entry, 'INDmoney MCP', new Date().toISOString(), OHLC_TTL_MS);
    }
    const stats = entry ? entityStats.safeParse(entry.entity_stats) : null;
    const basic = entry?.entity_basic as Record<string, unknown> | undefined;
    const live = stats?.success ? stats.data : null;
    const latestClose = history.at(-1)?.value;
    const price = live?.live_price ?? latestClose ?? security.price;
    const now = new Date().toISOString();
    const marketCap = Number(basic?.market_cap_in_currency);

    return {
      security: {
        ...security,
        price,
        previousClose: live?.prev_close ?? history.at(-2)?.value ?? price,
        high52: live?.['52week_high'],
        low52: live?.['52week_low'],
        volume: live?.volume,
        marketCap: Number.isFinite(marketCap) ? marketCap : undefined,
        exchange: typeof basic?.exchange === 'string' ? basic.exchange : security.exchange,
        asOf: live?.last_updated ?? now,
        source: 'INDmoney MCP',
      },
      history,
      // INDmoney's market tools expose statements only through segments Folio does
      // not request, so say that rather than presenting zeroes as figures.
      fundamentals: { periods: [], currency: 'INR', source: 'Unavailable from INDmoney MCP', asOf: now },
    };
  } finally {
    await client.close().catch(() => {});
  }
}
