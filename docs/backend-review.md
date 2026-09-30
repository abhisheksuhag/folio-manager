# Backend review

Reviewed against `docs/backend-brief.md` and `docs/server.md`, including `server/**` and `tests/server.test.ts`.

## Verdict

The backend implements most of the route surface and several sound security basics, but it is not ready for a multi-user live deployment. Spec compliance is **partial** because user isolation, broker credential ownership, import semantics, and financial-data failure handling have material gaps. Code quality is **mixed**: the modules are compact and readable and the happy paths are well structured, but globally shared records and broad fallback behavior make failures silent and financially misleading.

## Material findings

### 1. Critical — one user can overwrite another user's security data

`securities.id` is global (`server/db.ts:13`) while `user_securities` only links users to that shared row (`server/db.ts:14`). Every holdings, constituents, Upstox, or MCP import calls `upsertSecurity`, whose conflict branch updates the global name, sector, price, previous close, indices, date, and source (`server/db.ts:149-155`). User-scoped reads then join back to that shared row (`server/db.ts:163-165`, `server/db.ts:185-187`). Deterministic CSV IDs make collisions expected (`server/imports.ts:63-68`).

Reproduction: user B imported `us:nasdaq:aapl` at 200, then user A imported the same ID at 999. User B's unchanged workspace returned 999 afterward. Constituent memberships leak similarly because indices are merged into the global row.

Fix by separating a global immutable instrument identity/catalog from user-owned quote and membership observations, or include `user_id` in the key for imported security rows and in all holding/watchlist references. Add a two-user regression test that imports the same ticker with different quotes and index membership.

### 2. Critical — the deployment-wide INDmoney token exposes one upstream portfolio to every registered user

There is one `INDMONEY_MCP_TOKEN` in process configuration (`server/config.ts:42-43`). Any authenticated non-demo user can call the sync route, which invokes the MCP adapter with that same token and writes the returned holdings into the caller's workspace (`server/app.ts:177-193`, `server/providers/live.ts:85-104`). No connection record, OAuth state, or per-user credential is required for INDmoney.

Scenario: if the operator configures their INDmoney MCP token and allows registration, a newly registered user can POST `/api/connections/indmoney/sync` and receive a copy of the operator's holdings in their own workspace. This is both a credential-ownership failure and cross-user financial-data disclosure.

Make the MCP credential user-bound, or explicitly restrict this adapter to a configured single owner/single-user deployment and reject every other user. A server-wide token must never be callable by arbitrary registered accounts.

### 3. Major — user-supplied transaction IDs collide across users and are silently discarded

`transactions.id` is a global primary key even though de-duplication is intended to be per user (`server/db.ts:16`). A supplied CSV ID becomes that primary key verbatim (`server/imports.ts:93-94`), and `INSERT OR IGNORE` suppresses every constraint failure (`server/db.ts:190-195`).

Reproduction: user A imported provider ID `provider-42` and received `{imported:1}`. User B imported an otherwise valid transaction with the same provider ID and received `{imported:0}`; user B's transaction list remained empty. Common broker-generated IDs will therefore cause cross-user data loss.

Use an internal random/namespaced primary key and store provider IDs separately with `UNIQUE(user_id, broker, provider_id)`. Replace broad `INSERT OR IGNORE` with an explicit conflict target for the per-user content hash so unrelated integrity failures surface as errors.

### 4. Major — an unrecognized Upstox success payload wipes the last good holdings snapshot

The Upstox parser converts any HTTP-200 response whose `data` is absent or not an array into `[]` (`server/providers/live.ts:71-80`). Sync treats that as a successful empty portfolio, deletes the existing broker holdings first (`server/db.ts:172-180`), records a successful audit event, and returns `{ok:true}` (`server/app.ts:181-196`).

Reproduction with a stubbed 200 response `{status:"error", errors:[...]}`: `fetchUpstoxHoldings` returned zero rows rather than rejecting it. A provider error envelope or schema change would erase the user's current snapshot.

Validate the complete provider envelope, including the provider success status and `data` array, before entering the replacement transaction. Preserve the previous snapshot on every unknown or error payload. Test HTTP 200 error envelopes, missing `data`, malformed rows, and a legitimate empty array separately.

### 5. Major — unavailable FX produces confident zero-value analysis, while configured FX is falsely dated as current

Live workspaces encode missing USD/INR as zero (`server/app.ts:58-62`). The deterministic analysis multiplies every USD holding by that zero and still returns concentration and movement answers sourced as "Configured FX" (`server/app.ts:76-88`).

Reproduction: with no `USDINR`, a valid one-share AAPL holding at USD 200 produced: `Technology is the largest sector at 0.0% (₹0) of the ₹0 portfolio`, with source `Current holdings and configured FX`. This contradicts the explicit unavailable source in the workspace. When `USDINR` is configured, the code stamps today's date on every response (`server/app.ts:59`), even if the environment value is stale.

Represent unavailable FX explicitly rather than as a calculation-ready zero, and refuse INR aggregate/allocation/movement answers while USD holdings lack FX. Add a configured observation date such as `USDINR_AS_OF` and carry the workspace FX source and date into every calculated answer.

### 6. Major — CSV validation accepts financially inconsistent and unreachable records

The row schemas validate each enum independently but do not enforce currency/country/asset-class relationships (`server/imports.ts:8-31`). The date check is only a regular expression (`server/imports.ts:14`), so impossible dates such as `2026-99-99` pass. Ticker, exchange, and index fields accept arbitrary nonempty strings (`server/imports.ts:16-31`), although imported IDs are later rejected by the stock/watchlist route grammar (`server/imports.ts:63-68`, `server/app.ts:65-67`). Prices and prior closes also accept zero for a live holding (`server/imports.ts:13`, `server/imports.ts:18-20`).

Reproduction: a holdings row with `country=US`, `currency=INR`, `assetClass=Indian equity`, and `asOf=2026-99-99` returned 200 and was stored. This bypasses FX conversion and can make workspace dates and portfolio values wrong. A ticker containing `:` similarly creates a security returned by search/workspace that cannot be opened or added to a watchlist.

Add cross-field refinements for the supported country/currency and asset-class combinations, parse and round-trip real calendar dates, apply the same identifier segment grammar during import, and require positive current prices where a holdings snapshot claims a quote. Normalize a validated transaction `securityId` before storing it (`server/imports.ts:91-94`).

### 7. Major — Alpha Vantage normalization creates incorrect or invented structured facts

Symbol search uses Alpha Vantage field `3. type` as the exchange (`server/providers/live.ts:31-36`), producing IDs such as `us:equity:aapl` instead of an exchange-qualified instrument ID and preventing de-duplication with imports. Quote `asOf` is set to request time rather than the provider's latest trading day (`server/providers/live.ts:40-55`). `DividendYield` is stored as the provider fraction while the rest of the app treats the field as a percentage (`server/providers/live.ts:55`, `server/app.ts:97-98`). Missing free cash flow, debt, and cash are emitted as numeric zero (`server/providers/live.ts:56-57`), which structured clients cannot distinguish from reported zero.

A stub quote dated 2026-09-04 returned an `asOf` of 2026-09-06, a provider dividend yield of `0.0045` remained `0.0045` instead of the app's percent convention, and all unavailable statement values became zero.

Use a documented exchange mapping or leave exchange explicitly unknown without pretending it is the security type; use the provider trading date; normalize yield units consistently; and model unavailable fundamentals as missing or omit the period instead of fabricating zeros. The textual source disclaimer does not make zero-valued structured fields safe for charts or calculations.

### 8. Moderate — import and sync locks do not serialize competing writes for the same user and broker

Imports use `${user.id}:import` (`server/app.ts:172`) while syncs use `${user.id}:${broker}:sync` (`server/app.ts:181`). They can therefore overlap even though both eventually replace holdings. A slow Upstox fetch can begin, a newer CSV import can complete, and then the stale fetch can overwrite it. Each individual SQLite transaction is atomic, but the user-visible operation is not serialized from provider read through commit.

Use one portfolio mutation lock at least per user and broker for both import and sync. Keep provider fetch plus conditional commit under an operation/version guard so an older response cannot overwrite a newer snapshot.

### 9. Moderate — some imports are not one transaction and constituent imports do not mark a CSV connection

Transactions commit before `upsertCsvConnection` (`server/imports.ts:87-96`), and history replacement commits before its connection update (`server/imports.ts:98-105`). Constituents run in a transaction but never create/update the requested broker connection (`server/imports.ts:107-111`). This does not meet the brief's requirement that the import operation be atomic and that live imports mark method `csv`.

Wrap each complete import, including connection metadata, in one store transaction. Avoid nested transaction helpers by exposing transaction-aware store primitives. Decide whether constituent membership is broker-independent; if the API continues to require `broker`, update that connection consistently or remove the broker field for this kind in a revised contract.

## What is solid

- Sessions store only token hashes, rotate after authentication, use HTTP-only SameSite cookies, and have server-side CSRF tokens (`server/app.ts:40-41`, `server/app.ts:119-146`, `server/db.ts:56-79`). Watchlist and connection mutations include user ownership predicates.
- Passwords use salted scrypt and broker tokens use AES-256-GCM with tamper detection (`server/security.ts:11-46`). Production validates `APP_ORIGIN` and a 32-byte encryption key (`server/config.ts:48-54`).
- Demo data remains in the demo provider, registered workspaces do not fall back to it, and the docs accurately state that live upstream calls were not tested with credentials. Demo content is deterministic, dated, and clearly labeled illustrative.
- The optional AI boundary uses an HTTPS configuration URL, sends bounded current-user portfolio context without email or credentials, and has no tool-write path (`server/app.ts:103-110`, `server/app.ts:201-204`). User and CSV text remain untrusted model inputs, so the output should continue to be labeled interpretation and must never drive automated portfolio writes.
- `cached_market_data` is currently unused, so there is no active cache cross-user leak. Any later cache implementation should restrict this table to public instrument data or include user/provider identity in keys for private data.

## Verification

`npm run typecheck` completed with zero errors. `npm test` could not start because `tsx` hit `uv_os_get_passwd ... ENOMEM` in this sandbox, so the same test entry was bundled to CommonJS with esbuild and run with Node: all 6 tests passed. Focused bundled reproductions confirmed findings 1, 3, 4, 5, 6, and 7.

The existing suite covers registration/login, one CSRF rejection, watchlist ownership, token encryption, one invalid CSV row, duplicate content import, and the absence of demo fallback. It needs regression coverage for shared-security mutation, identical provider IDs across users, semantic currency/date validation, missing FX, provider schema errors preserving snapshots, INDmoney credential ownership, and import/sync ordering.
