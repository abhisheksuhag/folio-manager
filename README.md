# Folio

Personal portfolio tracker and investment research tool for stocks, funds, and crypto. Folio brings holdings from INDmoney (US assets), Upstox (Indian equities and funds), and Binance (crypto) into one view, with INR/USD-aware totals, watchlists, market sentiment, and evidence-grounded analysis.

Folio is **read-only**: it never places trades. Demo data is isolated and clearly labeled, and real accounts start empty.

![Landing page](docs/landing-desktop.png)

## Features

- **Unified portfolio**: dashboard, holdings, transactions, and performance charts across brokers, with explicit currency treatment (INR and USD) and data provenance on every figure.
- **Broker connections**: Upstox OAuth, INDmoney read-only MCP, and Binance API keys. CSV import is available as a complete fallback for holdings, transactions, history, and index constituents.
- **Research**: symbol search, quotes, price history, and fundamentals (Alpha Vantage), plus index views.
- **Watchlists**: create, rename, and manage lists of securities.
- **Market sentiment**: Fear & Greed gauges for Global, US, India, and Crypto from public feeds.
- **Analysis**: ask questions about your portfolio. Answers are deterministic calculations by default; an optional OpenAI-compatible model can be plugged in.
- **Graceful missing data**: unavailable inputs are shown as unavailable, never silently replaced with made-up values.
- **Responsive**: desktop, tablet, and phone.

## Tech stack

- **Frontend**: React 19, React Router, TanStack Query, Recharts, Vite
- **Backend**: Express 5, SQLite, Zod, Helmet, rate limiting
- **Tooling**: TypeScript, tsx, Node's test runner, Playwright

## Getting started

Requires Node.js 22.13 or newer.

```bash
npm install
```

Create a `.env` file in the project root (see [Configuration](#configuration)). For local development you can start with no keys at all and use the demo mode.

```bash
npm run dev
```

This starts the API (`tsx watch server/index.ts`) and the Vite dev server together. Vite proxies `/api` to the server.

### Production

```bash
npm run build
npm start
```

`npm start` runs `dist/server.js` with `NODE_ENV=production`, which serves the built client from `dist/client`. Production refuses to start without `APP_ORIGIN` and `TOKEN_ENCRYPTION_KEY`.

## Configuration

Set these in `.env` (loaded by `dotenv`). Everything except the production requirements is optional; features whose keys are missing are simply unavailable.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`. |
| `PORT` | API port (default `4301`). |
| `DATABASE_PATH` | SQLite file (default `data/folio.db`). |
| `APP_ORIGIN` | Exact browser origin. **Required in production.** |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters (32 bytes) used for AES-256-GCM encryption of broker tokens. **Required in production.** Generate with `openssl rand -hex 32`. |
| `USDINR` | Manual USD/INR fallback. Without it (and without an Alpha Vantage key) FX is reported as unavailable. |
| `ALPHA_VANTAGE_API_KEY` | Live search, quotes, history, fundamentals, and the USD/INR rate. |
| `UPSTOX_CLIENT_ID`, `UPSTOX_CLIENT_SECRET`, `UPSTOX_REDIRECT_URI` | Upstox OAuth. The redirect URI must match the one registered with Upstox. |
| `INDMONEY_MCP_URL`, `INDMONEY_REDIRECT_URI` | INDmoney read-only MCP (URL defaults to the official endpoint). |
| `AI_API_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_REASONING_EFFORT` | Optional OpenAI-compatible chat-completions provider for portfolio analysis. |

Credentials stay on the server and are never sent to the browser. Broker tokens are stored encrypted.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | API and web app with hot reload. |
| `npm run build` | Typecheck, build the client, and bundle the server. |
| `npm start` | Run the production build. |
| `npm test` | Unit and API tests (hermetic; no network or real keys used). |
| `npm run test:e2e` | Build and run Playwright end-to-end tests. |
| `npm run typecheck` | TypeScript check only. |

To reset a user's password, see `scripts/reset-password.ts`.

## Project layout

```
server/    Express API, SQLite access, CSV imports, security, providers
  providers/  demo, live market data, Upstox/INDmoney/Binance, research, sentiment
shared/    Types and pure logic shared by client and server (analytics, sentiment)
src/       React app (pages, components, styles)
tests/     Unit, API, and Playwright e2e tests
docs/      Server/API notes, sentiment methodology, design docs
scripts/   Production launcher and maintenance scripts
```

## Security notes

- Sessions use an HTTP-only cookie with server-side hashing; state-changing requests require a CSRF token, and browser `Origin` must match `APP_ORIGIN`.
- Uploads are validated in full before any write, and CSV files are capped at 5 MB.
- Never commit `.env` or any file containing real keys. `.env` and `data/` are gitignored.

## Documentation

- [Server and API reference](docs/server.md)
- [Market sentiment methodology](docs/market-sentiment.md)
- [Product and design notes](PRODUCT.md), [DESIGN.md](DESIGN.md)

## Disclaimer

Folio is a personal tracking and research tool, not investment advice. Data comes from third-party providers and may be delayed or unavailable; each figure shows its source and date where known.
