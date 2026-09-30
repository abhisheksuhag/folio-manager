# Backend implementation report

## Delivered

The server implements the fixed API contract in `docs/backend-brief.md` with an exported `createApp` for integration tests and a port-3001 entry point. SQLite initializes users, hashed sessions, broker connections, accounts, securities and per-user membership, holdings, transactions, snapshots, watchlists/items, analysis conversations/messages, market cache, and redacted audit tables with foreign keys enabled.

Security controls include scrypt password hashes, random server-side session hashes, HTTP-only same-site cookies, CSRF tokens, browser origin checks, Helmet headers, API and auth rate limits, strict Zod mutation bodies, owner-qualified mutations, AES-256-GCM broker token encryption, expiring hashed OAuth state, and generic JSON errors. Production fails fast if `APP_ORIGIN` or `TOKEN_ENCRYPTION_KEY` is absent.

The deterministic demo provider contains twelve holdings across US and Indian equities, two mutual funds and QQQ, a searchable catalog of thirty securities, five sample indices, 730+ daily history points ending 2026-09-04, illustrative transactions, one-year stock charts, and five financial periods. The final portfolio-history value and invested value are derived from the same holdings and fixed INR conversion used by the workspace.

Live workspaces start empty. CSV imports are all-or-nothing, broker-scoped for holdings, stable-hash de-duplicated for transactions, separate for historical snapshots, and safe for constituent membership. Alpha Vantage, official Upstox OAuth/holdings, the bounded INDmoney read-only MCP adapter, and an optional HTTPS compatible AI boundary are configuration-gated. No provider silently falls back to demo data.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit --pretty false` checks the complete TypeScript workspace.
- `tests/server.test.ts` exercises registration/login, CSRF denial, cross-user watchlist denial, AES-GCM encryption/tamper detection, full-file CSV validation and transaction de-duplication, and live/demo isolation against ephemeral localhost servers and in-memory SQLite.
- The normal `npm test` command is defined as `tsx --test tests/*.test.ts`. On this Windows Node 25 host, `tsx` currently fails before test discovery because `os.userInfo()` returns `uv_os_get_passwd ENOMEM`. Bundling the unchanged test entry with the installed esbuild and running it with Node's native test runner completed all 6 tests with 0 failures.
- The full TypeScript workspace check completed with 0 errors, and the server entry point bundled successfully. A separate consistency check found 12 demo holdings, 30 searchable securities, 730 history points, INR 2,381,186.85 current value, INR 1,947,134.50 invested value, and a 22.29% illustrative gain. The final history point exactly matches both totals and ends on 2026-09-04.

## Configuration and limits

Exact environment variables and CSV columns are documented in `docs/server.md` and `.env.example`. Live FX is configured through `USDINR`; when absent the response is explicitly unavailable. Alpha Vantage overview supplies TTM fundamentals and leaves unavailable statement fields at zero with a source label. Provider rate limits and upstream availability remain external constraints.

Upstox tests do not use real credentials. Sync currently consumes official long-term holdings; verified positions and mutual-fund normalization can be added once their official response contracts are confirmed. INDmoney MCP tool names and response schema are deliberately allowlisted and may require adapter updates if the provider publishes a different schema. No speculative INDmoney OAuth or model-driven MCP writes are present.
