# Data coverage truthfulness plan

## Goal

Make `/api/data/coverage` distinguish published historical partitions from the latest source observation. A historical partition must remain visible, but it must not conceal a recent canary failure, empty result, unsupported capability, or stale observation. Canary matching must use both market and canonical instrument; guest responses must not expose instrument-specific canary history.

## Tasks

1. Add failing unit tests in `tests/data-coverage-status.test.cjs` for: history plus latest failure => partial; successful empty => empty (not unavailable); source failure without history => failed/unavailable according to the API contract; conflicts => partial; a canary for another market/instrument is ignored; expired canary is historical/stale, not current-live.
2. Implement a pure coverage summary helper in `src/features/data-coverage-status.ts`; accept partition rows, same-scope discrepancy count, latest exact-scope canary observation and evaluation time. Preserve the components separately in the result (`partitionStatus`, `sourceStatus`, `dataStatus`, reason) instead of overwriting evidence.
3. Update `src/web/server.ts` `/api/data/coverage` to select only the newest matching canary observation for the requested market/instrument and pass it through the helper. Do not infer live status from a successful run with no records; use the capability response.
4. Extend the per-instrument coverage response to include consistent status/reason vocabulary and source observation age, without leaking another market's records.
5. Add route-contract tests for guest redaction, exact scope matching, event-source failure vs successful-empty wording, and backward-compatible response fields.
6. Verify `npm run build`, focused tests, `npm test`, `npm run smoke:web`, `npm run smoke:auth`, `npm run security:scan`, and `git diff --check`.

## Acceptance

Old data remains queryable as historical evidence, but the top-level status cannot say healthy/current if the newest exact-scope provider check failed or is stale. Empty source results and source failures remain distinguishable. No cross-market fallback is introduced.
