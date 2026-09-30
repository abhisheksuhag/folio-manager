# Folio server

The Express server listens on port `3001` by default and stores live user data in SQLite at `data/folio.db`. Development uses Vite's `/api` proxy. A production build serves `dist/client` and falls back to its `index.html` for non-API GET requests.

Copy `.env.example` to `.env` and set the values needed for your deployment. Production refuses to start without an exact `APP_ORIGIN` and a `TOKEN_ENCRYPTION_KEY` containing 64 hexadecimal characters (32 bytes). `DATABASE_PATH` selects the SQLite file. `USDINR` is a manually configured live FX observation; if it is missing, workspace FX is returned as `USDINR: 0`, an empty `asOf`, and a source explaining that FX is unavailable. The server never substitutes demo FX for a live account.

`ALPHA_VANTAGE_API_KEY` enables live symbol search, quotes, daily price history and overview fundamentals. `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`, `UPSTOX_REDIRECT_URI`, and `TOKEN_ENCRYPTION_KEY` enable Upstox OAuth. The redirect URI must exactly match the value registered with Upstox. `INDMONEY_MCP_URL` enables the bounded read-only MCP adapter; `INDMONEY_MCP_TOKEN` is optional. The adapter accepts only `get_holdings`, `portfolio_holdings`, or `read_portfolio`, validates the returned holdings, and rejects unknown tool/result schemas. `AI_API_URL`, `AI_API_KEY`, and `AI_MODEL` together enable an HTTPS OpenAI-compatible chat-completions provider.

Authentication uses an HTTP-only `folio_session` cookie and a server-side session hash. First call `GET /api/session`; send its `csrfToken` in `X-CSRF-Token` on every POST, PATCH, and DELETE. Authentication rotates the cookie, so call `GET /api/session` again after demo, register, or login. Browser requests with an `Origin` header must match `APP_ORIGIN`. All API errors use `{ "error": "message" }`.

## API

- Session and auth: `GET /api/session`, `POST /api/auth/demo`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`.
- Workspace: `GET /api/workspace`, `PATCH /api/preferences`.
- Discovery: `GET /api/search?q=...`, `GET /api/stocks/:id`, `GET /api/indices/:id`.
- Watchlists: create with `POST /api/watchlists`, rename with `PATCH /api/watchlists/:id`, delete with `DELETE /api/watchlists/:id`, and add/remove securities through `/api/watchlists/:id/items`.
- Imports: `POST /api/import` and `GET /api/import/template?kind=holdings|transactions|history|constituents`.
- Connections: `POST /api/connections/upstox/connect`, the Upstox callback, `POST /api/connections/upstox/sync`, `POST /api/connections/indmoney/sync`, and `DELETE /api/connections/:id`.
- Analysis: `GET /api/analysis/messages` and `POST /api/analysis`.

Demo users get isolated database users and watchlists. All illustrative quotes, holdings, transactions, portfolio history, stock history, fundamentals, and index samples come from `server/providers/demo.ts`, carry explicit dates and sources, and never appear in a registered workspace. Demo index responses are samples and always return `complete: false`.

## CSV imports

Download a template from the template endpoint to preserve spelling and capitalization. The parser validates the complete file before opening the write transaction, reports one-based CSV row numbers, caps files at 5 MB, and rejects extra or missing columns. Holdings replace only the selected broker's holdings. Transactions are additive and de-duplicated by their supplied `id` or a stable content hash. History replaces only prior CSV history. Constituents add index memberships and never overwrite a nonzero quote with zero.

The columns are:

- `holdings`: `ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf,accountId,isin`. The first twelve are required. `accountId` defaults to `default`; `isin` is optional.
- `transactions`: `id,date,securityId,ticker,name,broker,accountId,type,quantity,price,amount,currency,splitRatio`. `date`, `ticker`, `name`, `type`, `quantity`, `price`, `amount`, and `currency` are required. `broker`, when present, must match the selected broker. An optional `securityId` must already belong to the user. `id`, `accountId`, and `splitRatio` are optional.
- `history`: `date,value,invested,netFlow,benchmark`. The first four are required and are interpreted in INR. `benchmark` is optional.
- `constituents`: `index,ticker,name,exchange,currency,country,sector,assetClass`. The first seven are required. `assetClass` defaults from country.

Supported currencies are `INR` and `USD`; countries are `IN` and `US`; asset classes are `US equity`, `Indian equity`, `Mutual fund`, `ETF`, and `Cash`. Stock IDs are deterministic lowercase `country:exchange:ticker` values such as `us:nasdaq:aapl`.

Portfolio imports are rejected in demo mode with a prompt to create a real account. Imports mark the relevant live connection as `csv`. Disconnecting deletes the encrypted provider token and that broker's current holdings. It deliberately preserves transactions, imported history, securities referenced by user data, and watchlists, so the user's historical record remains intact.

## Provider boundaries

Upstox sync uses the official long-term holdings endpoint and normalizes the available exchange, ISIN, quantity, cost, last price, and close. Sector is explicitly unavailable because that endpoint does not supply it. Tokens are encrypted with AES-256-GCM and marked expired after an upstream 401. Upstox does not document a refresh-token flow used here, so reconnect after expiry. Positions and mutual funds are not merged until a verified official response contract is available.

The INDmoney MCP path is configurable because a stable public tool schema is not assumed. It performs tool discovery, permits only the three read-only names listed above, and validates every returned holding. CSV remains the complete fallback. Upstream INDmoney MCP and Upstox calls require the user's own credentials and have not been exercised by the local automated tests.

Without AI configuration, analysis answers are deterministic calculations over current structured data and are labeled `calculated`. Unsupported news, historic valuation, or forecast questions say which input is missing. Optional AI receives bounded holdings/stock context only: no credentials, tokens, or email address. Provider failures return a recoverable error instead of silently substituting generated text.
