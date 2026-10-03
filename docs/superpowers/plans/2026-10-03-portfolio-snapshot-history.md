# Portfolio snapshot history plan

## Goal

Create private, append-only valuation snapshots from explicit committed manual/CSV portfolio imports. Compare snapshots only as per-currency valuation observations. Never label raw valuation movement as investment return, and never infer missing cash flows, FX, account identity, or unknown paper-ledger currencies.

## Tasks

1. Add failing unit tests in `tests/portfolio-snapshot-history.test.cjs` for stable snapshot identity/hash, market/account/currency grouping, unknown account or currency handling, changed holdings and cash-flow warnings, no fabricated return, and bounded history.
2. Add snapshot and comparison contracts to `src/features/portfolio-snapshot-history.ts`. Capture exact imported rows, timestamp, market/account provenance, per-currency values, evidence source, and content hash. Comparison reports value delta only when matching scope/currency exists, labels it as valuation change, and reports why it is not a return.
3. Extend `src/features/decision-intelligence-store.ts` with a bounded append-only snapshot store and market/account filtering.
4. On successful `commit:true` in `/api/portfolio/import`, save snapshots from the committed resulting portfolio state. Preview calls must not persist. Preserve existing history and do not create snapshots for rejected rows.
5. Add admin-only `GET /api/portfolio/snapshots` and `GET /api/portfolio/snapshots/compare?before=&after=` routes. Validate IDs and same market/account scope; return explicit empty/unavailable states.
6. Add a compact private history panel to the existing portfolio workspace in `src/web/public/index.html`; show captured time, source, currency-specific values/deltas and a prominent “估值变化，不等于投资收益” explanation. Do not add it to the market dashboard or guest pages.
7. Verify focused tests, `npm run build`, full `npm test`, web/auth/browser smoke, security scan, and diff check.

## Acceptance

Only committed imports create snapshots. Comparisons cannot combine currencies or unrelated accounts. UI/API explicitly distinguish valuation change from return. Existing imported rows and unified paper ledger remain separate unless the user already explicitly selects combined analysis.
