import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Broker, Connection, HistoryPoint, Security, Transaction, User, Watchlist } from '../shared/types.ts';
import { hashToken, randomToken } from './security.ts';

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT, currency TEXT NOT NULL DEFAULT 'INR', demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS broker_connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, broker TEXT NOT NULL, status TEXT NOT NULL, method TEXT NOT NULL, encrypted_token TEXT, token_expires_at TEXT, oauth_state_hash TEXT, oauth_state_expires_at TEXT, last_sync TEXT, permissions_json TEXT NOT NULL DEFAULT '[]', UNIQUE(user_id, broker));
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, broker TEXT NOT NULL, external_id TEXT, name TEXT NOT NULL, currency TEXT NOT NULL, UNIQUE(user_id, broker, external_id));
CREATE TABLE IF NOT EXISTS securities (id TEXT PRIMARY KEY, ticker TEXT NOT NULL, name TEXT NOT NULL, exchange TEXT NOT NULL, currency TEXT NOT NULL, country TEXT NOT NULL, asset_class TEXT NOT NULL, sector TEXT NOT NULL, isin TEXT, color TEXT NOT NULL, logo TEXT, price REAL NOT NULL, previous_close REAL NOT NULL, market_cap REAL, pe REAL, eps REAL, dividend_yield REAL, high52 REAL, low52 REAL, volume REAL, description TEXT, indices_json TEXT NOT NULL DEFAULT '[]', as_of TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user_securities (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, security_id TEXT NOT NULL REFERENCES securities(id) ON DELETE CASCADE, PRIMARY KEY(user_id, security_id));
CREATE TABLE IF NOT EXISTS holdings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, security_id TEXT NOT NULL REFERENCES securities(id), broker TEXT NOT NULL, account_id TEXT NOT NULL, quantity REAL NOT NULL, average_price REAL NOT NULL, UNIQUE(user_id, broker, account_id, security_id));
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, content_hash TEXT NOT NULL, date TEXT NOT NULL, security_id TEXT, ticker TEXT NOT NULL, name TEXT NOT NULL, broker TEXT NOT NULL, account_id TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, price REAL NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, split_ratio REAL, UNIQUE(user_id, content_hash));
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, date TEXT NOT NULL, value REAL NOT NULL, invested REAL NOT NULL, net_flow REAL NOT NULL, benchmark REAL, source TEXT NOT NULL, UNIQUE(user_id, date, source));
CREATE TABLE IF NOT EXISTS watchlists (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS watchlist_items (watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE, security_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(watchlist_id, security_id));
CREATE TABLE IF NOT EXISTS ai_conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT, kind TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cached_market_data (cache_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, source TEXT NOT NULL, as_of TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_securities (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, security_id TEXT NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, security_id));
CREATE TABLE IF NOT EXISTS user_security_observations (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, security_id TEXT NOT NULL REFERENCES securities(id) ON DELETE CASCADE, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, security_id));
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT, event TEXT NOT NULL, entity_type TEXT, entity_id TEXT, result TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id);
`;

export interface SessionRecord { token: string; csrfToken: string; userId: string | null; }

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') {
      const absolute = resolve(path);
      mkdirSync(dirname(absolute), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(schema);
    this.migrate();
  }

  /** Additive column migrations for databases created before a column existed. */
  private migrate(): void {
    const columns = new Set((this.db.prepare('PRAGMA table_info(broker_connections)').all() as Array<Record<string, unknown>>).map((row) => String(row.name)));
    const added: Array<[string, string]> = [
      ['encrypted_refresh_token', 'TEXT'],
      ['oauth_client_json', 'TEXT'],
      ['oauth_verifier', 'TEXT'],
    ];
    for (const [name, type] of added) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE broker_connections ADD COLUMN ${name} ${type}`);
    }
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createSession(userId: string | null = null): SessionRecord {
    const token = randomToken();
    const csrfToken = randomToken();
    const now = new Date();
    const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    this.db.prepare('INSERT INTO sessions (id_hash,user_id,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run(hashToken(token), userId, csrfToken, expires.toISOString(), now.toISOString());
    return { token, csrfToken, userId };
  }

  getSession(token: string | undefined): Omit<SessionRecord, 'token'> | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT user_id,csrf_token,expires_at FROM sessions WHERE id_hash=?').get(hashToken(token)) as Record<string, unknown> | undefined;
    if (!row || String(row.expires_at) <= new Date().toISOString()) return null;
    return { userId: row.user_id ? String(row.user_id) : null, csrfToken: String(row.csrf_token) };
  }

  replaceSession(oldToken: string | undefined, userId: string | null): SessionRecord {
    if (oldToken) this.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hashToken(oldToken));
    return this.createSession(userId);
  }

  deleteSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id_hash=?').run(hashToken(token));
  }

  getUser(id: string): User | null {
    const row = this.db.prepare('SELECT id,name,email,currency,demo FROM users WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), name: String(row.name), email: String(row.email), currency: row.currency as User['currency'], demo: Boolean(row.demo) } : null;
  }

  getUserAuth(email: string): { user: User; passwordHash: string | null } | null {
    const row = this.db.prepare('SELECT id,name,email,currency,demo,password_hash FROM users WHERE email=?').get(email.toLowerCase()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { user: { id: String(row.id), name: String(row.name), email: String(row.email), currency: row.currency as User['currency'], demo: Boolean(row.demo) }, passwordHash: row.password_hash ? String(row.password_hash) : null };
  }

  createUser(input: { name: string; email: string; passwordHash?: string; demo?: boolean }): User {
    const id = randomToken(18);
    const user: User = { id, name: input.name, email: input.email.toLowerCase(), currency: 'INR', demo: Boolean(input.demo) };
    this.db.prepare('INSERT INTO users (id,name,email,password_hash,currency,demo,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, user.name, user.email, input.passwordHash ?? null, user.currency, user.demo ? 1 : 0, new Date().toISOString());
    return user;
  }

  updateUser(id: string, input: { name?: string; currency: User['currency'] }): User {
    if (input.name !== undefined) this.db.prepare('UPDATE users SET name=?,currency=? WHERE id=?').run(input.name, input.currency, id);
    else this.db.prepare('UPDATE users SET currency=? WHERE id=?').run(input.currency, id);
    return this.getUser(id)!;
  }

  seedDemoWatchlist(userId: string): void {
    const id = randomToken(12);
    this.db.prepare('INSERT INTO watchlists (id,user_id,name,created_at) VALUES (?,?,?,?)').run(id, userId, 'Ideas', new Date().toISOString());
  }

  watchlists(userId: string): Watchlist[] {
    const rows = this.db.prepare('SELECT id,name FROM watchlists WHERE user_id=? ORDER BY created_at').all(userId) as Array<Record<string, unknown>>;
    const items = this.db.prepare('SELECT security_id FROM watchlist_items WHERE watchlist_id=? ORDER BY created_at');
    return rows.map((row) => ({ id: String(row.id), name: String(row.name), securityIds: (items.all(String(row.id)) as Array<Record<string, unknown>>).map((item) => String(item.security_id)) }));
  }

  getWatchlist(userId: string, id: string): Watchlist | null {
    return this.watchlists(userId).find((watchlist) => watchlist.id === id) ?? null;
  }

  createWatchlist(userId: string, name: string): Watchlist {
    const id = randomToken(12);
    this.db.prepare('INSERT INTO watchlists (id,user_id,name,created_at) VALUES (?,?,?,?)').run(id, userId, name, new Date().toISOString());
    return { id, name, securityIds: [] };
  }

  renameWatchlist(userId: string, id: string, name: string): Watchlist | null {
    const result = this.db.prepare('UPDATE watchlists SET name=? WHERE id=? AND user_id=?').run(name, id, userId);
    return result.changes ? this.getWatchlist(userId, id) : null;
  }

  deleteWatchlist(userId: string, id: string): boolean {
    return Boolean(this.db.prepare('DELETE FROM watchlists WHERE id=? AND user_id=?').run(id, userId).changes);
  }

  addWatchlistItem(userId: string, id: string, securityId: string): Watchlist | null {
    if (!this.getWatchlist(userId, id)) return null;
    this.db.prepare('INSERT OR IGNORE INTO watchlist_items (watchlist_id,security_id,created_at) VALUES (?,?,?)').run(id, securityId, new Date().toISOString());
    return this.getWatchlist(userId, id);
  }

  removeWatchlistItem(userId: string, id: string, securityId: string): Watchlist | null {
    if (!this.getWatchlist(userId, id)) return null;
    this.db.prepare('DELETE FROM watchlist_items WHERE watchlist_id=? AND security_id=?').run(id, securityId);
    return this.getWatchlist(userId, id);
  }

  upsertSecurity(userId: string, security: Security): void {
    const existing=this.security(security.id);
    const mergedIndices=[...new Set([...(existing?.indices??[]),...security.indices])];
    const existingObservation=this.securityForUser(userId,security.id);
    const observedIndices=[...new Set([...(existingObservation?.indices??[]),...security.indices])];
    const observation:Security={...security,price:security.price>0?security.price:existingObservation?.price??0,previousClose:security.previousClose>0?security.previousClose:existingObservation?.previousClose??0,marketCap:security.marketCap??existingObservation?.marketCap,pe:security.pe??existingObservation?.pe,eps:security.eps??existingObservation?.eps,dividendYield:security.dividendYield??existingObservation?.dividendYield,high52:security.high52??existingObservation?.high52,low52:security.low52??existingObservation?.low52,volume:security.volume??existingObservation?.volume,description:security.description??existingObservation?.description,indices:observedIndices,asOf:security.asOf||existingObservation?.asOf||'',source:security.price>0||!existingObservation?security.source:existingObservation.source};
    this.db.prepare(`INSERT INTO securities (id,ticker,name,exchange,currency,country,asset_class,sector,isin,color,logo,price,previous_close,market_cap,pe,eps,dividend_yield,high52,low52,volume,description,indices_json,as_of,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,asset_class=excluded.asset_class,sector=excluded.sector,isin=COALESCE(excluded.isin,securities.isin),color=excluded.color,price=CASE WHEN excluded.price>0 THEN excluded.price ELSE securities.price END,previous_close=CASE WHEN excluded.previous_close>0 THEN excluded.previous_close ELSE securities.previous_close END,indices_json=excluded.indices_json,as_of=excluded.as_of,source=excluded.source`)
      .run(security.id,security.ticker,security.name,security.exchange,security.currency,security.country,security.assetClass,security.sector,security.isin??null,security.color,security.logo??null,security.price,security.previousClose,security.marketCap??null,security.pe??null,security.eps??null,security.dividendYield??null,security.high52??null,security.low52??null,security.volume??null,security.description??null,JSON.stringify(mergedIndices),security.asOf,security.source);
    this.db.prepare('INSERT OR IGNORE INTO user_securities (user_id,security_id) VALUES (?,?)').run(userId, security.id);
    this.db.prepare('INSERT INTO user_security_observations (user_id,security_id,payload_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,security_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at')
      .run(userId,security.id,JSON.stringify(observation),new Date().toISOString());
  }

  security(id: string): Security | null {
    const row = this.db.prepare('SELECT * FROM securities WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? mapSecurity(row) : null;
  }

  securities(userId: string): Security[] {
    const rows = this.db.prepare('SELECT s.*,o.payload_json observation_json FROM securities s JOIN user_securities us ON us.security_id=s.id LEFT JOIN user_security_observations o ON o.user_id=us.user_id AND o.security_id=us.security_id WHERE us.user_id=? ORDER BY s.ticker').all(userId) as Array<Record<string, unknown>>;
    return rows.map(mapObservedSecurity);
  }

  securityForUser(userId:string,id:string):Security|null {
    const row=this.db.prepare('SELECT s.*,o.payload_json observation_json FROM securities s JOIN user_securities us ON us.security_id=s.id LEFT JOIN user_security_observations o ON o.user_id=us.user_id AND o.security_id=us.security_id WHERE us.user_id=? AND s.id=?').get(userId,id) as Record<string,unknown>|undefined;
    return row?mapObservedSecurity(row):null;
  }

  userHasSecurity(userId:string,id:string):boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM user_securities WHERE user_id=? AND security_id=?').get(userId,id));
  }

  /** Research observations are isolated from shared portfolio quotes. */
  upsertResearchSecurity(userId:string,security:Security):void {
    const prior=this.researchSecurity(userId,security.id)??this.securityForUser(userId,security.id);
    if(prior){
      const keepQuote=prior.price>0&&(!(security.price>0)||(prior.asOf&&security.asOf&&prior.asOf>security.asOf));
      security={...prior,...security,...(keepQuote?{price:prior.price,previousClose:prior.previousClose,asOf:prior.asOf,source:prior.source,volume:prior.volume}:{})};
    }
    this.db.prepare('INSERT INTO research_securities (user_id,security_id,payload_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,security_id) DO UPDATE SET payload_json=excluded.payload_json,updated_at=excluded.updated_at')
      .run(userId,security.id,JSON.stringify(security),new Date().toISOString());
  }

  researchSecurity(userId:string,id:string):Security|null {
    const row=this.db.prepare('SELECT payload_json FROM research_securities WHERE user_id=? AND security_id=?').get(userId,id) as Record<string,unknown>|undefined;
    if(!row) return null;
    try { return JSON.parse(String(row.payload_json)) as Security; } catch { return null; }
  }

  researchSecurities(userId:string):Security[] {
    const rows=this.db.prepare('SELECT payload_json FROM research_securities WHERE user_id=? ORDER BY security_id').all(userId) as Array<Record<string,unknown>>;
    return rows.flatMap((row)=>{try{return [JSON.parse(String(row.payload_json)) as Security];}catch{return [];}});
  }

  replaceBrokerHoldings(userId: string, broker: Broker, rows: Array<{ security: Security; accountId: string; quantity: number; averagePrice: number }>, method: Connection['method'] = 'csv'): number {
    return this.transaction(() => {
      this.db.prepare('DELETE FROM holdings WHERE user_id=? AND broker=?').run(userId, broker);
      const insert = this.db.prepare('INSERT INTO holdings (id,user_id,security_id,broker,account_id,quantity,average_price) VALUES (?,?,?,?,?,?,?)');
      for (const row of rows) {
        this.upsertSecurity(userId, row.security);
        insert.run(randomToken(14), userId, row.security.id, broker, row.accountId, row.quantity, row.averagePrice);
      }
      this.upsertConnection(userId, broker, method);
      return rows.length;
    });
  }

  holdings(userId: string) {
    const rows = this.db.prepare('SELECT h.id holding_id,h.security_id,h.broker,h.account_id,h.quantity,h.average_price,s.*,o.payload_json observation_json FROM holdings h JOIN securities s ON s.id=h.security_id LEFT JOIN user_security_observations o ON o.user_id=h.user_id AND o.security_id=h.security_id WHERE h.user_id=? ORDER BY s.ticker').all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.holding_id), security: mapObservedSecurity(row), broker: row.broker as Broker, accountId: String(row.account_id), quantity: Number(row.quantity), averagePrice: Number(row.average_price) }));
  }

  insertTransactions(userId: string, transactions: Array<Transaction & { contentHash: string }>): number {
    return this.transaction(() => {
      const insert = this.db.prepare('INSERT OR IGNORE INTO transactions (id,user_id,content_hash,date,security_id,ticker,name,broker,account_id,type,quantity,price,amount,currency,split_ratio) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      let count = 0;
      for (const row of transactions) count += Number(insert.run(`${userId}:${row.id}`,userId,row.contentHash,row.date,row.securityId??null,row.ticker,row.name,row.broker,row.accountId,row.type,row.quantity,row.price,row.amount,row.currency,row.splitRatio??null).changes);
      return count;
    });
  }

  transactions(userId: string): Transaction[] {
    const rows = this.db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC').all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id:String(row.id),date:String(row.date),securityId:row.security_id?String(row.security_id):undefined,ticker:String(row.ticker),name:String(row.name),broker:row.broker as Broker,accountId:String(row.account_id),type:row.type as Transaction['type'],quantity:Number(row.quantity),price:Number(row.price),amount:Number(row.amount),currency:row.currency as Transaction['currency'],splitRatio:row.split_ratio==null?undefined:Number(row.split_ratio) }));
  }

  replaceHistory(userId: string, rows: HistoryPoint[]): number {
    return this.transaction(() => {
      this.db.prepare("DELETE FROM snapshots WHERE user_id=? AND source='CSV import'").run(userId);
      const insert = this.db.prepare('INSERT INTO snapshots (id,user_id,date,value,invested,net_flow,benchmark,source) VALUES (?,?,?,?,?,?,?,?)');
      for (const row of rows) insert.run(randomToken(14),userId,row.date,row.value,row.invested,row.netFlow,row.benchmark??null,'CSV import');
      return rows.length;
    });
  }

  history(userId: string): HistoryPoint[] {
    const rows = this.db.prepare('SELECT date,value,invested,net_flow,benchmark FROM snapshots WHERE user_id=? ORDER BY date').all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({date:String(row.date),value:Number(row.value),invested:Number(row.invested),netFlow:Number(row.net_flow),benchmark:row.benchmark==null?undefined:Number(row.benchmark)}));
  }

  upsertCsvConnection(userId: string, broker: Broker): void {
    this.upsertConnection(userId, broker, 'csv');
  }

  upsertConnection(userId: string, broker: Broker, method: Connection['method']): void {
    const id = `${userId}:${broker.toLowerCase()}`;
    const permissions = broker === 'Upstox' ? ['read holdings', 'read positions'] : ['read holdings'];
    this.db.prepare(`INSERT INTO broker_connections (id,user_id,broker,status,method,last_sync,permissions_json) VALUES (?,?,?,'connected',?,?,?) ON CONFLICT(user_id,broker) DO UPDATE SET status='connected',method=excluded.method,last_sync=excluded.last_sync,permissions_json=excluded.permissions_json`).run(id,userId,broker,method,new Date().toISOString(),JSON.stringify(permissions));
  }

  connections(userId: string): Connection[] {
    const rows = this.db.prepare('SELECT c.*, (SELECT COUNT(*) FROM holdings h WHERE h.user_id=c.user_id AND h.broker=c.broker) holdings_count FROM broker_connections c WHERE c.user_id=?').all(userId) as Array<Record<string, unknown>>;
    return rows.map((row)=>({id:String(row.id),broker:row.broker as Broker,status:row.status as Connection['status'],method:row.method as Connection['method'],lastSync:row.last_sync?String(row.last_sync):undefined,holdingsCount:Number(row.holdings_count),permissions:JSON.parse(String(row.permissions_json)) as string[]}));
  }

  saveOAuthState(userId: string, state: string, broker: Broker): void {
    const id = `${userId}:${broker.toLowerCase()}`;
    this.db.prepare(`INSERT INTO broker_connections (id,user_id,broker,status,method,oauth_state_hash,oauth_state_expires_at,permissions_json) VALUES (?,?,?,'disconnected','oauth',?,?, '["read holdings","read positions"]') ON CONFLICT(user_id,broker) DO UPDATE SET oauth_state_hash=excluded.oauth_state_hash,oauth_state_expires_at=excluded.oauth_state_expires_at`).run(id,userId,broker,hashToken(state),new Date(Date.now()+10*60_000).toISOString());
  }

  consumeOAuthState(state: string, broker: Broker): { id: string; userId: string } | null {
    const row = this.db.prepare('SELECT id,user_id,oauth_state_expires_at FROM broker_connections WHERE broker=? AND oauth_state_hash=?').get(broker,hashToken(state)) as Record<string,unknown>|undefined;
    if (!row || String(row.oauth_state_expires_at) < new Date().toISOString()) return null;
    this.db.prepare('UPDATE broker_connections SET oauth_state_hash=NULL,oauth_state_expires_at=NULL WHERE id=?').run(String(row.id));
    return { id:String(row.id),userId:String(row.user_id) };
  }

  saveBrokerToken(id: string, encryptedToken: string, expiresAt?: string): void {
    this.db.prepare("UPDATE broker_connections SET encrypted_token=?,token_expires_at=?,status='connected',method='oauth',last_sync=? WHERE id=?").run(encryptedToken,expiresAt??null,new Date().toISOString(),id);
  }

  connection(userId: string, broker: Broker): Record<string,unknown>|null {
    return this.db.prepare('SELECT * FROM broker_connections WHERE user_id=? AND broker=?').get(userId,broker) as Record<string,unknown>|undefined ?? null;
  }

  markExpired(id: string): void { this.db.prepare("UPDATE broker_connections SET status='expired' WHERE id=?").run(id); }

  /** Ensures a connection row exists so an OAuth handshake has somewhere to store its state. */
  ensureConnection(userId: string, broker: Broker, permissions: string[] = ['read holdings']): string {
    const id = `${userId}:${broker.toLowerCase()}`;
    this.db.prepare(`INSERT INTO broker_connections (id,user_id,broker,status,method,permissions_json) VALUES (?,?,?,'disconnected','oauth',?) ON CONFLICT(user_id,broker) DO NOTHING`).run(id,userId,broker,JSON.stringify(permissions));
    return id;
  }

  saveOAuthClient(id: string, clientJson: string): void {
    this.db.prepare('UPDATE broker_connections SET oauth_client_json=? WHERE id=?').run(clientJson,id);
  }

  saveOAuthVerifier(id: string, verifier: string): void {
    this.db.prepare('UPDATE broker_connections SET oauth_verifier=? WHERE id=?').run(verifier,id);
  }

  /** Stores an access token plus its refresh token; both arrive already encrypted. */
  saveBrokerTokens(id: string, encryptedToken: string, encryptedRefreshToken: string | null, expiresAt?: string): void {
    this.db.prepare("UPDATE broker_connections SET encrypted_token=?,encrypted_refresh_token=?,token_expires_at=?,status='connected',method='oauth',last_sync=COALESCE(last_sync,?) WHERE id=?").run(encryptedToken,encryptedRefreshToken,expiresAt??null,new Date().toISOString(),id);
  }

/** Reads a cached provider payload. Returns expired entries too, flagged, so a
   *  caller can fall back to stale data when the provider is unreachable. */
  readCache(key: string): { payload: unknown; source: string; asOf: string; expired: boolean } | null {
    const row = this.db.prepare('SELECT payload_json,source,as_of,expires_at FROM cached_market_data WHERE cache_key=?').get(key) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return {
        payload: JSON.parse(String(row.payload_json)),
        source: String(row.source),
        asOf: String(row.as_of),
        expired: String(row.expires_at) <= new Date().toISOString(),
      };
    } catch { return null; }
  }

  writeCache(key: string, payload: unknown, source: string, asOf: string, ttlMs: number): void {
    this.db.prepare('INSERT INTO cached_market_data (cache_key,payload_json,source,as_of,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,source=excluded.source,as_of=excluded.as_of,expires_at=excluded.expires_at')
      .run(key, JSON.stringify(payload), source, asOf, new Date(Date.now() + ttlMs).toISOString());
  }

  setConnectionMethod(id: string, method: Connection['method']): void {
    this.db.prepare('UPDATE broker_connections SET method=? WHERE id=?').run(method,id);
  }

  connectionById(id: string): Record<string,unknown>|null {
    return this.db.prepare('SELECT * FROM broker_connections WHERE id=?').get(id) as Record<string,unknown>|undefined ?? null;
  }

  deleteConnection(userId: string, id: string): boolean {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT broker FROM broker_connections WHERE id=? AND user_id=?').get(id,userId) as Record<string,unknown>|undefined;
      if (!row) return false;
      this.db.prepare('DELETE FROM holdings WHERE user_id=? AND broker=?').run(userId,String(row.broker));
      this.db.prepare('DELETE FROM broker_connections WHERE id=? AND user_id=?').run(id,userId);
      return true;
    });
  }

  conversation(userId: string): string {
    const existing = this.db.prepare('SELECT id FROM ai_conversations WHERE user_id=? ORDER BY created_at LIMIT 1').get(userId) as Record<string,unknown>|undefined;
    if (existing) return String(existing.id);
    const id=randomToken(14); this.db.prepare('INSERT INTO ai_conversations (id,user_id,created_at) VALUES (?,?,?)').run(id,userId,new Date().toISOString()); return id;
  }

  addMessage(userId:string,message:{id:string;role:string;content:string;sources?:string[];kind?:string;date:string}):void {
    this.db.prepare('INSERT INTO ai_messages (id,conversation_id,role,content,sources_json,kind,created_at) VALUES (?,?,?,?,?,?,?)').run(message.id,this.conversation(userId),message.role,message.content,message.sources?JSON.stringify(message.sources):null,message.kind??null,message.date);
  }

  messages(userId:string) {
    const rows=this.db.prepare('SELECT m.* FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.user_id=? ORDER BY m.created_at').all(userId) as Array<Record<string,unknown>>;
    return rows.map((row)=>({id:String(row.id),role:row.role as 'user'|'assistant',content:String(row.content),sources:row.sources_json?JSON.parse(String(row.sources_json)) as string[]:undefined,kind:row.kind as 'calculated'|'ai'|undefined,date:String(row.created_at)}));
  }

  audit(userId:string|null,event:string,entityType?:string,entityId?:string,result='ok'):void {
    this.db.prepare('INSERT INTO audit_logs (id,user_id,event,entity_type,entity_id,result,created_at) VALUES (?,?,?,?,?,?,?)').run(randomToken(12),userId,event,entityType??null,entityId??null,result,new Date().toISOString());
  }
}

function mapSecurity(row:Record<string,unknown>):Security {
  return {id:String(row.security_id??row.id),ticker:String(row.ticker),name:String(row.name),exchange:String(row.exchange),currency:row.currency as Security['currency'],country:row.country as Security['country'],assetClass:row.asset_class as Security['assetClass'],sector:String(row.sector),isin:row.isin?String(row.isin):undefined,color:String(row.color),logo:row.logo?String(row.logo):undefined,price:Number(row.price),previousClose:Number(row.previous_close),marketCap:row.market_cap==null?undefined:Number(row.market_cap),pe:row.pe==null?undefined:Number(row.pe),eps:row.eps==null?undefined:Number(row.eps),dividendYield:row.dividend_yield==null?undefined:Number(row.dividend_yield),high52:row.high52==null?undefined:Number(row.high52),low52:row.low52==null?undefined:Number(row.low52),volume:row.volume==null?undefined:Number(row.volume),description:row.description?String(row.description):undefined,indices:JSON.parse(String(row.indices_json??'[]')) as string[],asOf:String(row.as_of),source:String(row.source)};
}

function mapObservedSecurity(row:Record<string,unknown>):Security {
  if(row.observation_json){try{return JSON.parse(String(row.observation_json)) as Security;}catch{/* use base row */}}
  return mapSecurity(row);
}
