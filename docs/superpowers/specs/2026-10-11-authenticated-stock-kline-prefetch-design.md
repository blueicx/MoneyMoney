# Authenticated Stock K-line Response Prefetch Design

Date: 2026-10-11
Scope: Reduce the first-render wait for an explicitly selected stock chart without changing data freshness, market isolation, or authorization behavior.

## Context

The stock chart bundle is already preloaded after the dashboard auth gate for an explicit stock-quotes deep link, while its execution waits for dashboard core readiness. The chart runtime currently starts `/api/stock/kline` only after it has loaded and restored the workspace. The API response is therefore still on the critical path. Stock deep links can contain a `timeframe`, but dashboard initialization currently does not apply that parameter to `currentStockKlinePeriod`; a prefetch must not use a period different from the chart.

## Selected design

For a URL that explicitly selects `market=stocks`, `workspace=stock-quotes`, and a valid stock instrument, start one same-origin K-line request only after the existing auth readiness gate. Do not prefetch shared workspaces, other markets/workspaces, pages without an explicit instrument, or historical/date-pinned contexts (`asOf`, `focusDate`, or intraday `date`). Use the valid `timeframe` from the URL when present; otherwise use the chart's existing default period (`5m`). Initialization must apply that same validated period before loading the chart.

Use the existing `/api/stock/kline` endpoint and its ordinary source-adjusted bounded chart window. Send credentials and `cache: 'no-store'`; do not add a provider, server cache, stale fallback, or alternate data path. The loader stores the request under a complete context key (market, workspace, normalized instrument, provider symbol if present, period, adjustment, and date/as-of scope). Once the chart runtime starts, it may consume the response exactly once only if its current context key matches. Route the matching payload through the existing response validation, status handling, rendering, and evidence metadata path. A non-matching, late, or already-consumed response is discarded.

On workspace/market/instrument/period change, invalidate the pending handoff; abort the request when possible. A failed matching prefetch follows the existing failed/empty UI state and manual retry path rather than triggering an immediate duplicate request. A context change starts the normal request for the new context. Never show prefetched data for a different symbol or period.

## Alternatives considered

1. **Authenticated exact-context response prefetch (selected):** overlaps the current chart request with dashboard-core startup and hands the same response to the chart. It targets the remaining request wait without changing the source or displaying stale data.
2. **Leave the current path unchanged:** avoids all additional request coordination but does not overlap provider latency with dashboard startup.
3. **Server-side warming:** may reduce provider latency but introduces shared-cache freshness, authorization, request-budget, and multi-user coordination concerns; out of scope.

## Failure handling and boundaries

- Authentication readiness must precede any prefetch request.
- Unknown or invalid symbol/timeframe, shared snapshot, other workspace/market, and historical/date-pinned contexts skip prefetch.
- HTTP errors, malformed payloads, wrong market/instrument/timeframe, empty results, or network errors are never rendered as successful data. Matching failures use the existing chart error/empty state; manual retry remains available.
- Existing provider cache status, source timestamp, freshness label, request cancellation, and response-revision checks remain authoritative.
- No changes to database/data lake, private account data, themes, auxiliary workspaces, AI runners, Telegram, or trading controls.

## Verification

Automated tests must prove:

1. No prefetch occurs before auth readiness or for non-stock, non-chart, shared, missing-instrument, or historical/date-pinned routes.
2. Only supported timeframe values are used; an accepted deep-link timeframe is applied to the initial chart and matches the prefetch key; invalid/missing values safely use the existing `5m` default.
3. The matching response is consumed once and produces exactly one `/api/stock/kline` request; mismatched, late, and duplicate responses are discarded.
4. Instrument/period/workspace changes and aborts cannot let an old response replace the current chart.
5. Empty, failed, malformed, stale/cached, and live payloads preserve the existing honest status/source handling; no stale fallback is introduced.

Run the focused tests, then `npm test`, `npm run build`, `npm run smoke:web`, `npm run smoke:auth`, `npm run smoke:browser`, `npm run smoke:live-kline`, `npm run security:scan`, and `git diff --check`. Use a controlled delayed endpoint to verify the overlap and single request, then repeat the real-provider browser benchmark without promising a fixed speedup. After implementation acceptance, commit/push and deploy under the existing MoneyMoney release procedure, touching only `moneymoney.service`; preserve `data/research.db`, the data lake, secrets, and rollback artifacts.
