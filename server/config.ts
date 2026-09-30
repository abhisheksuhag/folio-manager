import 'dotenv/config';

export interface AppConfig {
  databasePath: string;
  appOrigin?: string;
  tokenEncryptionKey?: string;
  environment: 'development' | 'test' | 'production';
  usdInr?: number;
  alphaVantageKey?: string;
  upstoxClientId?: string;
  upstoxClientSecret?: string;
  upstoxRedirectUri?: string;
  indmoneyMcpUrl?: string;
  indmoneyRedirectUri?: string;
  aiApiUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  /** OpenAI-style reasoning_effort passed through to the provider, e.g. "none". */
  aiReasoningEffort?: string;
  /** Injectable public-GET transport. Tests omit it to keep the app hermetic. */
  researchFetch?: typeof fetch;
}

export type AppOptions = Partial<AppConfig>;

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function loadConfig(overrides: AppOptions = {}): AppConfig {
  const environment = overrides.environment ?? (
    process.env.NODE_ENV === 'production' ? 'production' : process.env.NODE_ENV === 'test' ? 'test' : 'development'
  );
  // A test-configured app is hermetic: ambient environment (including a developer
  // .env loaded by dotenv above) must not leak into it, or a real API key on the
  // machine silently changes what the suite exercises.
  const env: NodeJS.ProcessEnv = environment === 'test' ? {} : process.env;
  const config: AppConfig = {
    databasePath: overrides.databasePath ?? env.DATABASE_PATH ?? 'data/folio.db',
    appOrigin: overrides.appOrigin ?? env.APP_ORIGIN,
    tokenEncryptionKey: overrides.tokenEncryptionKey ?? env.TOKEN_ENCRYPTION_KEY,
    environment,
    usdInr: overrides.usdInr ?? positiveNumber(env.USDINR),
    alphaVantageKey: overrides.alphaVantageKey ?? env.ALPHA_VANTAGE_API_KEY,
    upstoxClientId: overrides.upstoxClientId ?? env.UPSTOX_CLIENT_ID,
    upstoxClientSecret: overrides.upstoxClientSecret ?? env.UPSTOX_CLIENT_SECRET,
    upstoxRedirectUri: overrides.upstoxRedirectUri ?? env.UPSTOX_REDIRECT_URI,
    indmoneyMcpUrl: overrides.indmoneyMcpUrl ?? env.INDMONEY_MCP_URL ?? 'https://mcp.indmoney.com/mcp',
    indmoneyRedirectUri: overrides.indmoneyRedirectUri ?? env.INDMONEY_REDIRECT_URI,
    aiApiUrl: overrides.aiApiUrl ?? env.AI_API_URL,
    aiApiKey: overrides.aiApiKey ?? env.AI_API_KEY,
    aiModel: overrides.aiModel ?? env.AI_MODEL,
    aiReasoningEffort: overrides.aiReasoningEffort ?? env.AI_REASONING_EFFORT,
    researchFetch: overrides.researchFetch ?? (environment === 'test' ? undefined : globalThis.fetch.bind(globalThis)),
  };
  if (environment === 'production') {
    if (!config.appOrigin) throw new Error('APP_ORIGIN is required in production');
    if (!config.tokenEncryptionKey) throw new Error('TOKEN_ENCRYPTION_KEY is required in production');
  }
  if (config.tokenEncryptionKey && !/^[a-f\d]{64}$/i.test(config.tokenEncryptionKey)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters');
  }
  return config;
}
