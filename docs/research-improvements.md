# Portfolio and Explore improvements — 2026-09-07

User direction: simplify navigation, remove Transactions, merge Markets into Explore; focus Portfolio and a light India/US screener; explain mutual fund/ETF composition and individual businesses. Never test real accounts, reveal keys, submit orders, or perform external mutations.

Current evidence: live index route only supports user imports and returns 404 for public advertised indexes. Research uses the same stock metrics/tabs for funds. Indian mutual funds fall through Indian-stock and Alpha Vantage quote lookup. Unavailable time series consumes most of Portfolio. Existing OAuth connections and crypto balances were added by the user and must be preserved. `.env`, data files, current browser/account sessions are outside testing scope.

## Implementation
1. Read-only research data: fund-aware dispatch and composition, Indian index constituent GET downloads, US ETF/index constituent adapters, accurate quote metadata and graceful partial responses. All provider tests use fixtures/fakes; no real credentials or account calls. Shared contracts in shared/types.ts.
2. Unified navigation: Overview, Portfolio, Explore, Watchlists, Intelligence; Settings. Markets redirects to Explore; Transactions redirects to Portfolio. Portfolio brings holdings and performance together. Existing stored history stays intact.
3. Explore: compact universe control, India/US and stock/fund/ETF filters, sector filter, sort and optional valuation filters. Missing metrics excluded only when corresponding filters are active. Coverage/source/date always visible; never label ETF holdings as an official index census.
4. Fund detail: composition-first single page with underlying names/weights, sector/country/asset splits, dated coverage and unreported remainder, expense ratio/AUM where known, price/NAV history and own exposure. Never show stock revenue/earnings tabs for a fund. Stocks: price, relevant facts, actual financial periods and peers, with optional expanded statements.
5. Verify with isolated memory databases, synthetic provider fixtures, isolated browser session and network restrictions. Capture desktop/mobile. Do not navigate or sync the real-account app.

## Completion evidence required
- Simple navigation with redirected legacy routes and no visible Transactions/Markets duplicate.
- Screener query/filter/sort behavior for both markets, clear missing data, usable index pages even if upstream unavailable.
- Fund and ETF composition wired from provider to UI, percentages and timestamps correct, partial data shown without manufacturing full coverage; stock detail remains useful.
- Portfolio holdings, fund drilldown, currency calculations, missing history treatment verified.
- No real-account test or upstream order/write call; no keys exposed. Typecheck, tests, build and isolated browser evidence.

## Delivered and verified

Navigation now exposes Overview, Portfolio, Explore, Watchlists and Intelligence. The prior Holdings/Transactions URLs redirect to Portfolio, and Markets redirects to Explore. Portfolio leads with current positions, unknown cost/FX totals remain unavailable, funds link directly to composition, and insufficient performance history occupies a compact notice. Mobile navigation and horizontal table scrolling were corrected.

Explore includes India/US, asset type, published universe, sector, search, valuation filters, sorting, pagination, and CSV export. It uses official Nifty constituent files and explicitly labeled SPY/QQQ ETF proxies for US index coverage. A selected universe excludes unrelated local positions. Constituent metadata enriches existing valuations without replacing them with zero-price placeholders. Researched watchlist items remain visible and user scoped.

Fund pages lead with weighted holdings and indirect position exposure, source/report date, missing coverage, and reported allocation categories. ETF weights/expense ratios are converted once; unreported geography is not invented. US ETF quotes/history are loaded without company OVERVIEW. Mutual funds never fall through the stock ticker lookup. Owned crypto positions have readable details. Stock pages retain usable recorded valuations if enrichment fails, with company metrics, history, and annual financials when supplied.

Verification on 2026-09-07: `npm run build` passed (includes TypeScript); `npm test` passed 43 tests; `npx playwright test` passed 5 browser flows covering desktop/mobile. The browser fixture uses a new Chrome context, an ephemeral local port, memory-only SQLite, synthetic accounts, a GET-only browser boundary and denied server outbound fetch. Existing local servers, account sessions, .env contents and data files were not inspected or tested. API mutation tests exercise only synthetic memory databases and mocked providers, never brokerage orders or remote writes.

The independent reviewer identified ETF price/history bypass, crypto detail rejection and loss of existing quotes during constituent enrichment. These findings were fixed and covered by regression tests. The reviewer session subsequently hit a usage limit; final integration verification was completed locally.

Screenshots are generated under `test-results/research/`: explore-desktop/mobile.png, portfolio-desktop/mobile.png, fund-desktop/mobile.png. Reproduce with `npm run test:e2e` (builds the client and starts its own isolated test server).

## Provider availability limits

- This is an available-data screener. Constituent lists do not include every valuation metric; missing metrics are excluded by active valuation filters. It does not claim complete, live coverage of every Indian or US listing.
- MF composition requires a matching INDmoney provider fund identity and a recognized, validated payload. Unknown schema revisions or unmatched imported plans produce a clear unavailable state. Authenticated production payloads were deliberately not tested.
- The configured Alpha Vantage adapter supplies US ETF composition. Composition for an exact Indian ETF remains unavailable if no suitable provider supplies it; another exchange or fund is never substituted.
- Live annual company statements and MF NAV time series are not supplied by these current adapters. Empty annual periods are honest; mixed TTM overview metrics are never presented as five years of annual accounts.
- Provider report dates and retrieval dates are separate. Provider throttling and unavailable data retain valid cached observations where possible.
- Vite reports the existing large client bundle warning; the build succeeds. No deployment or existing server restart was performed.

## Market strip and allocation tooltip

The Overview market strip now shows compact daily-close sparklines, the latest recorded close, and change over the displayed period (up to 22 sessions). SPY and QQQ are explicitly labeled ETF proxies. NIFTY 50 uses the exact `NSE_INDEX|Nifty 50` instrument through an active direct Upstox connection. Hover/focus descriptions include dates and source; demo series are labeled illustrative. A missing feed never creates a synthetic live line. Expired cache data is retained with a saved-history label on provider failure; fresh results are cached for 12 hours and failures back off for five minutes. Concurrent requests share the same fetch.

Provider contracts: [Alpha Vantage daily series](https://www.alphavantage.co/documentation/#daily) and [Upstox V3 historical candles](https://upstox.com/developer/api-documentation/v3/get-historical-candle-data/). All new provider calls are GET requests. The authenticated endpoint does not sync holdings or modify broker accounts.

The shared allocation donut tooltip has an explicit stacking layer above its center label. The isolated browser regression verifies the actual paint order, desktop/mobile chart layout, missing-feed state, and index navigation. Build and TypeScript checks passed; the full 50-test suite and five focused market-trend tests passed (including two additional cases added afterward). Tests use synthetic data, mocked providers, memory SQLite, and an isolated browser; real accounts were not accessed. Existing processes were not restarted.
