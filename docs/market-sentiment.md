# Fear and greed panel

The overview dashboard renders `FearGreedPanel`, including in empty portfolios. Four accessible 0–100 gauges show Global, US, India, and Crypto with source links, observation dates, saved-data labels, and expandable methodology. The layout uses four columns on desktop and two on small screens, with light and dark themes.

Authenticated `GET /api/sentiment` uses only public read-only feeds through `researchFetch`; no broker credentials are needed. Demo sessions return explicitly illustrative fixtures without network requests.

## Sources

- US: [CNN Fear & Greed](https://www.cnn.com/markets/fear-and-greed), public `production.dataviz.cnn.io/index/fearandgreed/graphdata` JSON. This is a website feed, not a guaranteed API. It returned HTTP 418 during development on September 28, 2026; the integration preserves an honest unavailable state rather than bypassing the block.
- India: [Tickertape Market Mood Index](https://www.tickertape.in/market-mood-index), public page's `__NEXT_DATA__.props.pageProps.nowData` (`currentValue` and `date`). Only embedded JSON is parsed; scripts are never executed. This verified website format may change. Below 30 is extreme fear, above 70 extreme greed.
- Crypto: [Alternative.me API](https://alternative.me/crypto/fear-and-greed-index/#api), `https://api.alternative.me/fng/?limit=1`. Source attribution is next to the gauge. This index focuses on Bitcoin, not every cryptocurrency equally.
- Global: user-approved Folio blend, the arithmetic mean of all three scores. This is a limited sentiment summary, not a worldwide benchmark; provider methodologies differ. No blend is produced unless all three sources have valid, non-stale readings. Its date is the oldest input.

Each feed has a 30-minute shared public-data cache, per-store in-flight coalescing, a 10-second timeout, and five-minute backoff after failures. Last successful readings remain visible as Saved after a failure and do not enter the blend. Readings more than four days old are also Saved, accommodating weekends and holidays. Values outside 0–100, absent values, malformed timestamps and future timestamps beyond five minutes are rejected. No redirects, credentials, third-party mirrors, synthetic fallback scores or trades are used.

Unit tests use in-memory stores and injected responses. Browser tests use isolated synthetic sessions, deny external network access, cover responsive gauges, dark theme, retry, unavailable and saved states, and empty portfolios.
