# Dispatch Progress

Baseline: `96b74563e1f5db3c48b8f98c9d28e0205a626062`

## Task 1: Research free cross-platform prediction data
- status: done
- agent: explorer
- result: Selected keyless Gamma/Kalshi reads; borrowed activity/liquidity/spread ranking ideas from poly-maker.

## Task 2: Add prediction radar backend
- status: done
- agent: implementation-1
- result: Add cached keyless Polymarket/Kalshi market endpoints with normalization.

## Task 3: Add prediction radar UI
- status: done
- agent: implementation-2
- result: Add a cross-platform prediction radar section, filters, and refresh control.

## Task 4: Documentation
- status: done
- agent: implementation-3
- result: Update bilingual feature/data-source documentation.

## Task 5: Verification and release
- status: done
- agent: verification
- result: Filtered empty/demo venues from cross-platform matching; build passed; API returned 315 tradable markets with 0 false-positive opportunities; desktop/mobile browser checks rendered 29 cards.

## Round 2026-08-23: Equity options radar
- Baseline: `0fcdd3d462fbd7203913cf8305d6db63456f3e18`
### Task 1: Explore keyless US options data
- status: done
- agent: explorer
- result: Verified CBOE delayed quotes/options endpoint; borrowed positioning-dashboard patterns (PCR, max pain, GEX, walls) from GammaGrid.
### Task 2: Implement CBOE equity option backend
- status: done
- agent: implementation-1
- result: Added keyless CBOE delayed option chains, quote/IV30, PCR, max pain, delta and first-order GEX walls; exposed `/api/equity-options/:symbol`.
### Task 3: Upgrade options UI for Deribit + US symbols
- status: done
- agent: implementation-2
- result: Added market/symbol controls, quote/IV, GEX, Delta columns and quick symbols; fixed a request race so switching markets cannot let the older crypto response overwrite the newer US response.
### Task 4: Documentation and verification/release
- status: done
- agent: verification
- result: Build passed; API returned SPY with 12 expiries and CBOE source; desktop/mobile browser checks rendered the option chain, positioning metrics and 41 visible rows.

## Round 2026-08-23: Launcher, timezone and Chinese news fixes
- Baseline: `1710c57 Add CBOE US equity options radar`
### Task 1: Explore Chinese news sources
- status: done
- agent: explorer
- result: Verified keyless PANews Simplified Chinese RSS; CoinDesk China/Jinse/ChainCatcher/Odaily candidates were unavailable or non-RSS in this environment.
### Task 2: Fix launcher reuse and race
- status: done
- agent: implementation
- result: Added PID lock startup coordination so a second launcher waits for or reuses the existing dashboard instead of spawning another backend; added a WinForms tray client compiled without a console subsystem.
### Task 3: Add Chinese-first news and safe Beijing-time UI
- status: done
- agent: implementation
- result: Added CDATA-safe RSS parsing, PANews primary feed with Cointelegraph fallback, Chinese sentiment keywords, Chinese-first news sorting, explicit Asia/Shanghai labels, and escaped news links/titles.
### Task 4: Verify and package
- status: done
- agent: verification
- result: Build passed. `/api/crypto-news` returned PANews titles with ISO dates; desktop/mobile browser checks showed Chinese ticker/news and Beijing-time labels. Tray process stayed single-instance and started the dashboard without a console window; packaged binaries were copied to Desktop.

## Round 2026-08-23: Treasury yield-curve radar
- Baseline: `909214c Fix launcher reuse, add tray client and Chinese news`
### Task 1: Explore keyless rates data
- status: done
- agent: explorer
- result: Verified the official keyless U.S. Treasury daily par yield-curve CSV; FRED graph CSV timed out in this environment, so Treasury was selected as the authoritative primary source.
### Task 2: Implement rates backend and curve UI
- status: done
- agent: implementation
- result: Added `/api/macro/treasury-yields` with CSV parsing, daily bp changes, 2s10s/3m10s spreads, inversion status and caching; added a horizontally scrollable log-maturity curve, tenor tiles and mobile-safe layout.
### Task 3: Review, verify and document
- status: done
- agent: review-verification
- result: Review found no conflicts. Build passed; API returned the 2026-08-21 official curve with 11 maturities; desktop/mobile browser checks rendered 11 dots and 11 tenor tiles with zero console errors. Packaged core was rebuilt, copied to Desktop, and re-verified with single-launch reuse.

## Round 2026-08-23: Nasdaq earnings-calendar radar
- Baseline: `eda4726 Add US Treasury yield curve radar`
### Task 1: Explore keyless earnings data
- status: done
- agent: explorer
- result: Verified Nasdaq's public earnings-calendar endpoint and its browser-like header requirement; normalized market cap, consensus EPS and pre/post-market timing.
### Task 2: Implement earnings backend and UI
- status: done
- agent: implementation
- result: Added `/api/stock/earnings` with date selection, five-minute caching, US-market date handling, market-cap sorting and empty non-trading-day handling; added a responsive calendar section with summary chips, ticker badges, fact chips and timing badges.
### Task 3: Review, verify and package
- status: done
- agent: review-verification
- result: Review found no conflicts. Build passed; packaged API returned 2026-08-23 with zero rows and explicit 2026-08-21 with 11 companies; desktop/mobile browser checks rendered all 11 rows with zero console errors. Rebuilt core was copied to Desktop and restarted through the tray launcher.

## Round 2026-08-23: Fresh open-event feed
- Baseline: `db26d2e Add Nasdaq earnings calendar radar`
### Task 1: Diagnose stale open events
- status: done
- agent: explorer
- result: Confirmed the Predict.fun API exposes `endsAt`, publishes recurring windows continuously, and supports OPEN-status pagination; the old dashboard read only one mixed-status page and retained stale client odds/stats caches.
### Task 2: Implement freshness and scheduling
- status: done
- agent: implementation
- result: OPEN categories now paginate across three pages, hide invisible records and windows ended over 15 minutes ago, and sort by nearest start/end. The UI clears stale caches on refresh, bypasses HTTP cache, escapes titles, and shows live/upcoming/settling badges with Beijing start or end times.
### Task 3: Review, verify and package
- status: done
- agent: review-verification
- result: Review found no conflicts. Build passed; source and packaged APIs returned fresh OPEN feeds without expired tails (120 and 121 events), sorted by the nearest settlement window; desktop/mobile browser checks rendered schedule badges with zero console errors. Rebuilt core was copied to Desktop and relaunched through the tray.

## Round 2026-08-24: Smart trade advisor and launcher health
- Baseline: `207ad9b Fix open event freshness and scheduling`
### Task 1: Explore additional derivatives data
- status: done
- agent: explorer
- result: Binance futures endpoints timed out consistently in this environment; pivoted the advisor to already verified keyless Binance spot, Predict.fun, Fear & Greed and Gate.io funding sources.
### Task 2: Implement smart trade advisor
- status: done
- agent: implementation
- result: Added a transparent rules-based advisor with technical scores, prediction probability estimates, buy/sell/wait reminders, confidence, risk levels, entry/stop/target context and regime classification; added a responsive analysis-tab UI.
### Task 3: Fix launcher ownership check
- status: done
- agent: implementation
- result: Added a MoneyMoney health endpoint, made tray and Node launchers verify app identity before reuse, and made rapid second launches wait instead of opening premature dashboards.
### Task 4: Verify, package and document
- status: done
- agent: review-verification
- result: Build passed. Desktop and mobile UI checks rendered the advisor with zero console errors; packaged health and advisor APIs returned 6 reminders, 6 crypto actions and 3 prediction picks. Rebuilt both binaries and updated bilingual README sources/features.

## Round 2026-08-24: Assistant paper journal
- Baseline: `aed5fda Add smart trade advisor reminders`
### Task 1: Research journal patterns
- status: done
- agent: explorer
- result: Reviewed open-source trading journal/backtest patterns; adopted signal lifecycle, R multiples, confidence buckets, venue breakdown and plain-language lessons.
### Task 2: Implement self-tracking advisor journal
- status: done
- agent: implementation
- result: Added persistent keyless paper journal that records actionable advisor signals, checks Binance stop/target levels, resolves Predict.fun outcomes and expiries, and calculates win rate, R, profit factor and grouped statistics.
### Task 3: Add experience UI and review
- status: done
- agent: review-verification
- result: Added a responsive assistant simulation/experience panel with grouped stats, lessons and recent settlements; fixed a nested-template syntax issue, title mismatch and infinity display. Build and desktop/mobile browser checks passed with zero console errors.
### Task 4: Package and document
- status: done
- agent: release
- result: Rebuilt PredictBot.exe, verified live journal settlement (3 initial Predict.fun signals closed), updated bilingual README feature tables.

## Round 2026-08-24: Global stock advisor signals
- Baseline: `768848f Fix duplicate dashboard launch`
### Task 1: Implement stock technical advisor
- status: done
- agent: implementation
- result: Added keyless Tencent Finance daily technical signals for US stocks/ETFs, China A-shares and Hong Kong stocks; normalized GB18030 quote decoding and exchange suffixes for AAPL, MSFT, NVDA, TSLA, SPY, QQQ, 00700 and 600519.
### Task 2: Extend paper journal
- status: done
- agent: implementation
- result: Extended venue typing, added stock stop/target checks and expiry settlement through Tencent delayed quotes; actionable stock signals now enter the assistant simulation ledger.
### Task 3: Verify, document and release
- status: done
- agent: verification
- result: Build passed; advisor API returned 8 stock signals with no warnings; desktop/mobile checks rendered stock/ETF cards with zero console errors; journal recorded stock paper trades. Packaged, committed and pushed.

## Round 2026-08-24: Cross-asset risk radar
- Baseline: `09bd1f8 Add global stock advisor signals`
### Task 1: Add keyless CBOE index and volatility context
- status: done
- agent: implementation
- result: Added S&P 500, Nasdaq 100, Dow, Russell 2000 and VIX quotes with a transparent cross-asset risk score; integrated the score into advisor regime and a responsive radar panel.
- result: Build passed; risk API returned 5 index/VIX quotes plus BTC/ETH, advisor exposed the risk context, and desktop/mobile checks rendered the radar with zero console errors.

## Round 2026-08-24: Options strategy observations
- Baseline: `9668617 Add cross-asset risk radar`
### Task 1: Add per-expiry strategy engine
- status: done
- agent: implementation
- result: Extended the keyless Deribit/CBOE options model with deterministic strategy observations for iron condors, bull put spreads, bear call spreads and protective puts, using PCR, volume PCR, max pain, ATM IV, GEX, walls and time to expiry.
### Task 2: Verify, document and release
- status: done
- agent: verification
- result: Build passed; SPY and BTC APIs each returned four ranked ideas; desktop/mobile options checks rendered four cards with zero console errors and the SPY market switch also passed. Packaged health and SPY strategy API passed; bilingual README updated.

## Round 2026-08-24: Options strategies in assistant journal
- Baseline: `98c67d9 Reduce repeated launcher popups`
### Task 1: Research strategy journal patterns
- status: done
- agent: explorer
- result: Reviewed active options/paper-journal projects; adopted stable signal keys, persisted lifecycle records and per-strategy grouped statistics.
### Task 2: Implement option advisor signals
- status: done
- agent: implementation-options-signals
 - result: Added SPY/BTC strategy signals with explicit legs and net premium, admitted only scored positive-premium structures into advisor actions.
### Task 3: Extend settlement and lessons
- status: done
- agent: implementation-journal-settlement
 - result: Extended paper journal persistence, expiry settlement using Tencent/Binance spot prices, payoff/R calculations and grouped per-strategy lessons.
### Task 4: UI, docs and integration verification
- status: done
- agent: review-verification
 - result: Build passed; live advisor exposed four option actions and two open option journal entries; injected expiry cases settled correctly; desktop/mobile checks rendered the options panel with zero console errors.

## Round 2026-08-24: Macro FX and commodity advisor
- Baseline: `7c7d019 Add options strategies to assistant journal`
### Task 1: Research keyless macro data sources
- status: done
- agent: explorer
- result: Verified Frankfurter/ECB time series for EUR, GBP, AUD, JPY and CNY crosses plus Tencent daily history for GLD, SLV, USO, CPER, DBA and UNG commodity proxies.
### Task 2: Implement macro market data module
- status: done
- agent: implementation-macro-data
 - result: Added a cached keyless snapshot with ECB-backed FX crosses and Tencent commodity-proxy ETF daily bars.
### Task 3: Integrate macro technical signals
- status: done
- agent: implementation-advisor-signals
 - result: Added daily MA/RSI/MACD/ROC scoring for 11 macro instruments, separate advisor cards, risk levels and top reminder integration.
### Task 4: Extend paper journal settlement
- status: done
- agent: implementation-journal-settlement
 - result: Added Macro venue tracking, stop/target checks and expiry settlement; injected EURUSD expiry settled correctly at 1.1699 with +1.699R.
### Task 5: UI, docs and release verification
- status: done
- agent: review-verification
 - result: Build passed; desktop/mobile Playwright checks rendered 11 macro cards with zero console errors; packaged health/advisor smoke passed and bilingual docs were updated.

## Round 2026-08-24: Bond and credit market advisor
- Baseline: `e463cad`
### Task 1: Research keyless bond data sources
- status: done
- agent: explorer
- result: Confirmed Nasdaq public ETF history returns 120 daily bars for TLT, IEF, SHY, LQD and HYG without a key; US Treasury yield curve remains available for curve context.
### Task 2: Add bond series to macro snapshot
- status: done
- agent: implementation-bond-data
- result: Added Nasdaq public daily history for TLT, IEF, SHY, LQD and HYG; live snapshot returned all five 120-bar bond/credit proxies.
### Task 3: Integrate signals, curve context and journal settlement
- status: done
- agent: implementation-advisor-journal
- result: Bond signals now show Treasury 2s10s context and duration-aware stops; injected TLT expiry settled at 82.05 with a WIN and restored the journal afterward.
### Task 4: UI, documentation and release verification
- status: done
- agent: review-verification-release
- result: Build passed; live API returned 16 macro signals including all five bond/credit proxies; desktop and mobile checks rendered each bond card with zero console errors; injected TLT expiry settled correctly; packaged health/advisor smoke passed and bilingual docs were updated.

## Round 2026-08-24: Launcher duplicate-window fix
### Task 1: Prevent repeated browser tabs
- status: done
- agent: implementation-launcher
- result: Changed the desktop launcher to remain single-instance, detect an existing MoneyMoney dashboard window, signal the running tray instead of opening another tab, and prefer a dedicated Edge app window when available. Restart and repeated-launch smoke passed.

## Round 2026-08-24: Sector rotation radar
- Baseline: `b5ac091`
### Task 1: Verify keyless sector data source
- status: done
- agent: explorer-sector-data
- result: Nasdaq public ETF history returned 200 with 120 daily bars for all 11 SPDR sector ETFs plus SPY; no API key required.
### Task 2: Implement sector momentum model
- status: done
- agent: implementation-sector-model
- result: Added a keyless Nasdaq-backed sector rotation snapshot with 10/20-day relative momentum, 20/50-day trend filters, breadth, leaders/laggards, and cached error-aware data assembly.
### Task 3: Integrate advisor, journal and UI
- status: done
- agent: implementation-integration
- result: Wired sector signals into the advisor report, regime score, reminders, paper journal settlement, and a dedicated bilingual-facing dashboard rotation block.
### Task 4: Verify, document and release
- status: done
- agent: verification-release
- result: TypeScript build, packaged executable health check, live `/api/advisor` smoke, and Playwright UI smoke all passed with 11 sectors, 4 rotation actions, and no page errors. README documentation and the packaged release were updated.

## Round 2026-08-24b: Adaptive paper calibration
- Baseline: `f29c48a`
### Task 1: Add journal evidence model
- status: done
- agent: implementation-calibration
- result: Added bounded confidence/risk calibration from venue, confidence-bucket, and option-strategy paper results; evidence requires at least 8 global and 5 group samples.
### Task 2: Expose calibration in UI and docs
- status: done
- agent: implementation-calibration-ui
- result: Added historical win-rate badges, a calibration explanation block, and bilingual README coverage.
### Task 3: Verify and release
- status: done
- agent: verification-calibration
- result: Build passed; live advisor calibrated unique signals from closed paper trades (packaged release: 8 signals from 12 closed samples); desktop/mobile Playwright checks passed with no page errors or horizontal overflow.

## Round 2026-08-24c: Experience ranking
- Baseline: `94604d1`
### Task 1: Add conservative performance scoring
- status: done
- agent: implementation-experience-ranking
- result: Added Wilson lower-bound win rates to journal groups and a conservative market/strategy/confidence experience ranking with strong/watch/weak verdicts.
### Task 2: Surface ranking and harden calibration
- status: done
- agent: implementation-experience-ui
- result: Added high-confidence and caution panels to the advisor, switched signal calibration and badges to conservative win-rate estimates, and updated bilingual documentation.
### Task 3: Verify and release
- status: done
- agent: verification-experience
- result: Build, packaged executable health check, live advisor API, and Playwright UI smoke passed; the packaged release exposed 3 conservative high-confidence experience entries with no page errors.


## Round 2026-08-24d: Regime tilt and launcher fix
### Task 1: Environment-linked strategy tilt
- status: done
- agent: implementation-regime-tilt
 - result: Added conservative regime/direction evidence weighting that only reorders reminders when at least five samples and a meaningful priority gap exist; surfaced the model in UI and bilingual docs.
### Task 2: Launcher duplicate-window hardening
- status: done
- agent: implementation-launcher-release
 - result: Added a 15-second open debounce, suppressed direct backend browser opening when controlled by the tray, corrected dev data-root behavior, and rebuilt MoneyMoney.exe as a GUI subsystem executable.
### Task 3: Verification and release
- status: done
- agent: verification-release
 - result: Build and packaged health/advisor smoke passed; live advisor exposed regime tilt with 15 samples; release executables were rebuilt without console-subsystem launcher windows.

## Round 2026-08-24e: Volatility term-structure radar
- Baseline: cccde40
### Task 1: Research keyless volatility data
- status: done
- agent: explorer-volatility
- result: Verified CBOE delayed public quotes return VIX 9D, 1M, 3M, 6M and 12M without a key.
### Task 2: Implement term structure and advisor linkage
- status: done
- agent: implementation-volatility
 - result: Added keyless CBOE volatility points, 9D/3M slope classification, bounded risk-score adjustment, and ±3-point option confidence filtering with explicit reasons.
### Task 3: UI and bilingual docs
- status: done
- agent: implementation-ui-docs
 - result: Added a five-point volatility term panel to the advisor risk card and bilingual README/data-source coverage.
### Task 4: Verification and release
 - status: done
- agent: verification-release
 - result: TypeScript build passed; dev and packaged health/risk/advisor smoke returned five term points; desktop/mobile Playwright checks rendered the term block with no page errors or horizontal overflow; release executable was rebuilt.

## Round 2026-08-24f: Market regime detection
- Baseline: a9f2d90
### Task 1: Implement regime engine
- status: done
- agent: implementation-regime
- result: Added market-regime.ts with ADX (14), ATR% vs historical average, Bollinger Band Width percentile, and volume trend from Binance klines. Classifies seven regimes (strong/weak trend up/down, ranging, volatile expansion, squeeze) and caches per symbol:interval for 60 seconds.
### Task 2: Advisor linkage
- status: done
- agent: implementation-advisor
- result: Integrated getMarketRegime into buildContext via Promise.allSettled; added applyRegimeToOptions that adjusts option strategy confidence by current regime (trending favors directional, ranging favors condor, squeeze penalizes condor) with explicit Chinese reasons on every tagged signal.
### Task 3: UI and bilingual docs
- status: done
- agent: implementation-ui-docs
- result: Added market regime panel to the advisor risk card showing labelZh, symbol volume trend, and indicator summary; added bilingual README feature rows.
### Task 4: Verification and release
- status: done
- agent: verification-release
- result: npm run build passed; /api/regime returned BTCUSDT 4h "弱趋势上涨" (ADX 39.3); advisor context included marketRegime and all 4 option signals were tagged.

## Round 2026-08-24g: Paper trading risk analytics
- Baseline: 4ef3846
### Task 1: Implement risk metrics engine
- status: done
- agent: implementation-risk
- result: Added getRiskMetrics() to PaperTradingEngine computing Sharpe ratio, profit factor (capped at 99 for JSON), expectancy, VaR 95%, average win/loss, payoff ratio, max drawdown, best/worst trade, and equity curve from closed positions.
### Task 2: API and UI
- status: done
- agent: implementation-ui
- result: Added GET /api/paper/risk-metrics endpoint; added risk analytics panel to the paper trading tab showing eight metric cards with color coding; handles empty portfolio gracefully.
### Task 3: Verification and docs
- status: done
- agent: verification-docs
- result: Build passed; endpoint returns valid JSON with capped profitFactor/payoffRatio (99 instead of Infinity); README bilingual rows updated.

## Round 2026-08-24h: Support / resistance radar
- Baseline: 2797670
### Task 1: Implement S/R engine
- status: done
- agent: implementation-sr
- result: Added support-resistance.ts with fractal swing detection (3-bar lookback), tolerance-based clustering, and composite scoring by touch count + recency bonus + volume rank + proximity. Returns top 5 supports and resistances with distance from current price.
### Task 2: Advisor crypto integration
- status: done
- agent: implementation-advisor-sr
- result: analyzeCryptoTechnicals now fetches 4h S/R alongside ticker and klines; stop-loss placed below nearest support (or above nearest resistance for shorts); take-profit extended to next opposite level; reasons include touch counts.
### Task 3: UI and bilingual docs
- status: done
- agent: implementation-ui-docs
- result: Added S/R panel to the advisor risk card with green/red level chips showing price, touch count and distance; added bilingual README rows.
### Task 4: Verification
- status: done
- agent: verification-release
- result: Build passed; /api/support-resistance returned BTCUSDT 4h with 5 supports / 2 resistances, correct nearest levels and trend hint.

## Round 2026-08-24i: Multi-timeframe confluence and MoneyMoney cleanup
- Baseline: 9edc80d
### Task 1: Implement confluence engine
- status: done
- agent: implementation-confluence
- result: Added multi-timeframe.ts to score 15m/1h/4h/1d MA alignment, price deviation, and momentum; returns bullish/bearish/neutral direction, 0-100 confluence, per-timeframe signals, and a Chinese summary with a 90-second cache.
### Task 2: Advisor, API, and UI
- status: done
- agent: implementation-integration
- result: Added GET /api/confluence; linked BTC confluence into the crypto advisor so aligned trends add bounded confidence, conflicts reduce it, and the analysis card shows all four timeframe chips with score and summary.
### Task 3: MoneyMoney identity and desktop cleanup
- status: done
- agent: implementation-release
- result: Redrew the MoneyMoney coin/arrow icon for Windows and Android launchers, embedded it in the launcher and tray, renamed the packaged backend to MoneyMoneyCore.exe, changed the Android display name to MoneyMoney, removed PredictBot desktop exe/APK/bat/shortcut remnants, and left one MoneyMoney desktop shortcut.
### Task 4: Verification and docs
- status: done
- agent: verification-release
- result: TypeScript build and packaged core smoke passed; /api/health returned MoneyMoney and /api/confluence returned four timeframes with score 84; bilingual README now documents confluence and MoneyMoneyCore paths.

## Round 2026-08-24j: Macro event-risk guard
- Baseline: 6c600cf
### Task 1: Research and orchestrate
- status: done
- agent: orchestrator-explorer
- result: Reuse the existing keyless ForexFactory weekly calendar; no new dependency. Design a transparent 72-hour high-impact event guard with immediate/elevated/watch windows and bounded advisor confidence/risk reductions.
### Task 2: Implement event-risk engine and advisor linkage
- status: done
- agent: implementation-event-risk
- result: Added a 72-hour ForexFactory high-impact event engine with global/regional relevance, transparent bounded confidence/risk guards, disk-cache outage fallback, and advisor-wide signal linkage.
### Task 3: Add API and advisor UI
- status: done
- agent: implementation-ui
- result: Added GET /api/event-risk, a color-coded macro event-risk panel, event chips, and fixed the market-regime panel's duplicate JavaScript declaration that prevented advisor rendering.
### Task 4: Review, verify, document, and release
- status: done
- agent: review-verification-release
- result: TypeScript build passed; live event-risk API returned Watch with five events; desktop/mobile UI checks rendered the guard without overflow or page errors; rebuilt MoneyMoneyCore.exe passed MoneyMoney health and event-risk smoke; bilingual README documents the guard and cache fallback.

## Round 2026-08-24k: Desktop config discovery and Predict.fun 401 fix
- Baseline: 687b85e
### Task 1: Diagnose launcher environment
- status: done
- agent: orchestrator-explorer
- result: Reproduced the issue from release/core as CWD. The packaged backend missed the project-root .env, defaulted to Predict.fun mainnet, and sent a blank API key; the testnet endpoint itself returned 200 without auth.
### Task 2: Implement config and error handling
- status: done
- agent: implementation-config-ui
- result: Added nearest-.env discovery upward from the executable and CWD; avoided retrying Predict.fun 401/403 responses; mapped authorization failures to a friendly non-blocking dashboard warning.
### Task 3: Verify, package, and document
- status: done
- agent: verification-release
- result: Build passed; launcher-like Node test returned 150 open categories from testnet; Playwright desktop/mobile showed 150 cards with zero page errors and zero horizontal overflow; rebuilt MoneyMoneyCore.exe smoke returned health=MoneyMoney and 150 categories; bilingual README documents config discovery and temporary verification files were removed.

## Round 2026-08-24l: US stock encoding and search fix
- Baseline: ca4293c
### Task 1: Diagnose stock data pipeline
- status: done
- agent: orchestrator-explorer
- result: Tencent quote responses are GB18030 while the stock endpoints decoded them as UTF-8; search only checked a small hardcoded list instead of the keyless Tencent smartbox API.
### Task 2: Fix decoding and live symbol search
- status: done
- agent: implementation-stock
- result: Unified Tencent quote decoding as GB18030, added keyless Tencent Smartbox search for US/A-share/HK symbols, per-symbol quote caching, safe result rendering, and click-to-chart selection.
### Task 3: Verify UI, package, document, and publish
- status: done
- agent: verification-release
- result: Build and packaged-core smoke passed; desktop/mobile Playwright checks showed readable indices, AAPL search/click-to-chart, zero overflow and zero page errors; advisor output had zero replacement characters; bilingual README updated and temporary files removed.

## Round 2026-08-25a: Stablecoin liquidity radar
- Baseline: 27c475c
### Task 1: Research liquidity signal design
- status: done
- agent: orchestrator-explorer
- result: Reuse the existing keyless DefiLlama stablecoin API and add 1d/7d/30d net-flow scoring so liquidity expansion/contraction can support the advisor regime without becoming a standalone trigger.
### Task 2: Implement liquidity engine and advisor linkage
- status: done
- agent: implementation-stablecoin
- result: Added aggregate stablecoin supply/net-flow scoring, bounded regime boost, advisor context linkage, and corrected percentage aggregation so small-coin supply spikes cannot saturate the score.
### Task 3: Add API and dashboard UI
- status: done
- agent: implementation-ui
- result: Exposed the liquidity engine through /api/macro/stablecoins, added a bidirectional radar panel and advisor liquidity bias, and switched dashboard/API responses to no-store caching to avoid stale desktop pages.
### Task 4: Verify, package, document, and publish
- status: done
- agent: verification-release
- result: Build and desktop/mobile UI checks passed with readable stock names, AAPL search, stablecoin radar rendering, and no overflow/page errors; packaged-core smoke confirmed health, liquidity score 15.5, Dow Jones Chinese name, and AAPL search; bilingual README updated and temporary files removed.

## Round 2026-08-25b: Collapsible macro workbench
- Baseline: a5d73d7
### Task 1: Review dashboard length and UI pattern
- status: done
- agent: orchestrator-ui-explorer
- result: Confirmed the stocks tab stacked quotes, charts, macro, calendars, DeFi, and news into one very long page; selected native details/summary with persisted preferences to avoid a new dependency.
### Task 2: Implement collapsible dashboard sections
- status: done
- agent: implementation-ui
- result: Split the macro page into four labeled sections, added one-click expand/collapse, persisted per-section state in localStorage, and preserved every existing panel and load path.
### Task 3: Verify, package, document, and publish
- status: done
- agent: verification-release
- result: Build passed; desktop/mobile checks found 4 sections with 2 open by default, collapsed height 982/936 px versus expanded 12619/16340 px, zero overflow/page errors, and AAPL search still returned one result; packaged-core smoke confirmed health, four dashboard sections, liquidity score, and Apple search; bilingual README updated and temporary files removed.

## Round 2026-08-25c: Advisor caution flags and cache refresh
- Baseline: ab060ce
### Task 1: Research and orchestrate
- status: done
- agent: orchestrator-explorer
- result: Reuse existing macro, funding, sentiment, stablecoin, regime, and warning context to produce prioritized advisor caution cards without adding a paid dependency.
### Task 2: Implement caution engine and advisor linkage
- status: done
- agent: implementation-caution
- result: Added high/medium/observation Chinese caution flags, practical defensive advice, source context, funding-average context, and a prioritized six-card summary to the advisor report.
### Task 3: Add UI and stale-cache protection
- status: done
- agent: implementation-ui
- result: Added a collapsible advisor caution panel, bumped the service-worker cache, switched API/static fetch handling to network-first with successful-response-only fallback caching, and preserved the readable stock/search pipeline.
### Task 4: Verify, package, document, and publish
- status: done
- agent: verification-release
- result: TypeScript build passed; desktop/mobile checks found caution cards, AAPL search, Chinese US-index names, zero replacement characters, zero overflow, and zero page errors; packaged smoke confirmed health, four caution flags, Apple search, and cache v7; bilingual README updated.

## Round 2026-08-25d: Exit coach and stale UI refresh
- Baseline: 939a656
### Task 1: Diagnose stale stock UI and design exit coaching
- status: done
- agent: orchestrator-explorer
- result: Confirmed the packaged API already returned readable Chinese US-index names and AAPL as Apple; the visible garbling/search miss came from a stale browser cache. Designed live exit guidance from current prices, stop/target distance, R multiples, and prediction settlement timing.
### Task 2: Implement exit coach and cache bump
- status: done
- agent: implementation-exit-coach
- result: Added Chinese risk states and concrete exit actions for tracked paper positions, per-item fault-tolerant price lookups across Predict.fun, Binance, stocks, sectors, and macro, advisor UI rendering, safer stock-name rendering, and service-worker cache v8.
### Task 3: Verify, package, and document
- status: done
- agent: verification-release
- result: TypeScript build passed; desktop/mobile checks found readable indices, Apple search, exit coach, zero replacement characters, zero overflow, and zero page errors; packaged smoke confirmed health, cache v8, three readable US indices, Apple, and coaches for all five displayed open trades; bilingual README updated.

## Round 2026-08-25e: DeFi yield-quality radar
- Baseline: 860e325
### Task 1: Research risk-adjusted yield design
- status: done
- agent: orchestrator-explorer
- result: DefiLlama pools expose TVL, stablecoin flag, impermanent-loss risk, single/multi exposure, 30-day mean APY, APY trend, prediction confidence, and outlier flags. Use these to rank sustainable yield instead of chasing headline APY.
### Task 2: Implement yield-quality engine and API
- status: done
- agent: implementation-yield-engine
- result: Added DefiLlama pool quality scoring with TVL/stablecoin/IL/exposure gates, 30-day sustainability, 7-day trend, prediction confidence, incentive dependence, deduplication, and the risk-adjusted API.
### Task 3: Implement dashboard UI
- status: done
- agent: implementation-yield-ui
- result: Replaced raw APY ranking with a risk-adjusted radar summary, Chinese advice, four risk filters, and compact mobile-safe rows; fixed a script brace that could break stock search.
### Task 4: Review, verify, document, and release
- status: done
- agent: verification-release
- result: Build, desktop/mobile Playwright, packaged smoke, bilingual README, cache v9, readable US indices, BAC exchange-specific chart, and 16,937-pool yield scan all passed; temporary verification files removed before release.

## Round 2026-08-25f: SEC insider-transaction radar
- Baseline: 75f5f79
### Task 1: Research official free insider data
- status: done
- agent: orchestrator-explorer
- result: SEC EDGAR provides keyless company-to-CIK mapping and Form 4 XML. Parse the last 90 days of non-derivative transactions with owner role, buy/sell code, shares, price, aggregate value, owner breadth, and 10b5-1 plan context.
### Task 2: Implement Form 4 engine and API
- status: done
- agent: implementation-insider-engine
  result: Added keyless SEC ticker-to-CIK lookup, 90-day Form 4 discovery, bounded concurrent XML parsing, owner roles, buy/sell/value aggregation, 10b5-1 context, confidence, Chinese signals, caching, and the insider API.
### Task 3: Implement dashboard panel and stock-selection linkage
- status: done
- agent: implementation-insider-ui
  result: Added a collapsible US-stock insider radar with quick symbols, refresh, request race protection, Chinese summary cards, trade rows, disclaimers, and automatic linkage after selecting a US search result.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verification-release
  result: TypeScript build passed; AAPL/MSFT insider APIs and invalid-symbol handling passed; desktop checks found readable Chinese US names, 10 BAC search results, radar HTML, and zero horizontal overflow; bilingual README and cache v10 were updated before release packaging.

## Round 2026-08-25g: CFTC crypto positioning radar
- Baseline: 5421c57
### Task 1: Research official CFTC CME report format
- status: done
- agent: orchestrator-explorer
  result: The keyless CME futures-only CFTC page exposes Bitcoin and Ether cash-settled contracts with non-commercial long/short/spread, commercial, total, nonreportable, open interest, weekly changes, trader counts, and report date.
### Task 2: Implement COT engine and advisor linkage
- status: done
- agent: implementation-cot-engine
  result: Added keyless CFTC CME futures-only parsing for BTC/ETH with GB18030-safe retrieval, commitments/changes/percent/trader sections, six-hour caching, crowding classification, bounded regime boost, Chinese signals/advice, and advisor warning/source/context linkage.
### Task 3: Implement API and collapsible dashboard panel
- status: done
- agent: implementation-cot-ui
  result: Exposed /api/crypto/cot, added the collapsible CME positioning radar, advisor CFTC context row, and service-worker cache v11. Also hardened stock search with positive-result caching, retry, direct quote fallback, and extra offline ticker coverage.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verification-release
  result: TypeScript build passed; desktop/mobile checks found readable US names, BAC results, BTC/ETH COT radar, advisor CFTC context, zero replacement characters, zero overflow, and zero page errors; bilingual README was updated before release packaging.

## Round 2026-08-25h: SEC fundamental-quality radar
- Baseline: 21db44a
### Task 1: Research official SEC XBRL annual fundamentals
- status: done
- agent: explorer-sec-xbrl
  result: SEC companyfacts uses the lowercase us-gaap taxonomy and exposes keyless 10-K annual USD facts. Apple/Microsoft/Tesla confirm reliable coverage for revenue, profit, operating cash flow, assets, liabilities, equity, liquidity, and long-term debt across preferred and legacy tags.
### Task 2: Implement fundamental engine
- status: pending
  result: Implemented keyless SEC XBRL annual extraction with tag fallbacks, fiscal-year alignment, growth/profit/cash/liquidity/leverage/ROE scoring, three-year history, confidence, Chinese signals/advice, deduplication, and 12-hour caching.
### Task 3: Implement dashboard panel and selection linkage
- status: pending
  result: Added /api/stock/fundamentals/:symbol, a collapsible fundamentals radar with quick symbols, score/metric/history rendering, automatic US stock-selection linkage, cache v12, and preserved mobile-safe layout.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verification-release
  result: Rolling review fixed duplicate fiscal-year rows from legacy/new revenue tags. Build and secret scan passed; AAPL/MSFT/TSLA APIs returned aligned annual data; desktop/mobile checks found the fundamentals radar, BAC search, readable Chinese text, zero overflow, and zero page errors before bilingual README updates.

## Round 2026-08-25i: US stock encoding and tray recovery hotfix
- Baseline: 33ee935
### Task 1: Diagnose mojibake and empty search reports
- status: done
- agent: orchestrator-explorer
  result: Confirmed qt.gtimg.cn serves GBK while smartbox serves UTF-8; live quote/search parsing worked in source. The user-visible failure aligned with a stale page after the packaged backend exited while the tray launcher remained alive.
### Task 2: Implement encoding, naming, and launcher fixes
- status: done
- agent: implementation-hotfix
  result: Added response-charset-aware Tencent decoding, readable official English names for US quote cards, exchange-ticker aliases instead of pinyin shortcuts, service-worker cache v13, and tray reopen behavior that revives an exited core before opening the dashboard.
### Task 3: Verify, package, document, and publish
- status: done
- agent: verification-release
  result: TypeScript build passed. Packaged smoke returned Apple Inc./Tesla, Inc. quotes, AAPL/Tesla search results, health OK, and cache v13. Launcher compiled successfully; bilingual README documented recovery and encoding behavior before release.

## Round 2026-08-25j: Background position-risk patrol
- Baseline: 7284d64
### Task 1: Research mature risk-monitoring patterns
- status: done
- agent: explorer-risk-patterns
  result: Freqtrade (53.6k stars), Hummingbot (19.6k stars), and Jesse (8.4k stars) are active open-source risk frameworks. Their common pattern is continuous monitoring with stop-loss/take-profit guards, cooldown/de-duplication, drawdown context, and explicit action messages; MoneyMoney will apply this to its paper journal without copying code.
### Task 2: Implement background risk-patrol engine
- status: done
- agent: implementer-risk-engine
  result: Added AssistantRiskAlert/result models, a 90-second refresh path reusing all journal resolvers and exit coaches, severity ranking, and signature-based danger/profit push deduplication with recovery reset.
### Task 3: Add advisor UI and API linkage
- status: done
- agent: implementer-risk-ui
  result: Wired GET status and POST manual-run endpoints, started the singleton after server listen, and added a collapsible advisor panel with counts, top alerts, advice, expiry, errors, and manual patrol.
### Task 4: Review, test, document, package, and publish
- status: done
- agent: verification-risk-release
  result: Build passed; dev and packaged smoke confirmed health, readable US quotes/search, cache v14, risk-patrol status/run endpoints, advisor panel rendering, and no horizontal overflow. Bilingual feature docs and progress ledger updated.

## Round 2026-08-25k: Binance derivatives positioning radar
- Baseline: e780aa9 (clean)
### Task 1: Research mature positioning-radar patterns and keyless endpoints
- status: done
- agent: explorer-derivatives
  result: Confirmed Gate.io public contracts and tickers endpoints expose keyless funding rate, settlement interval, long/short account counts, open-interest contract size, mark price, and 24h quote volume; reused the existing advisor bounded-score pattern without copying external code.
### Task 2: Implement Binance derivatives radar engine
- status: done
- agent: implementer-derivatives
  result: Added keyless Gate.io USDT perpetual engine with funding interval/annualization, next settlement, long/short account crowding, open-interest USD, 24h volume, bounded regime boost, and Chinese advice.
### Task 3: Integrate advisor context, UI panel, and API route
- status: done
- agent: integrator-dashboard
  result: Wired radar into assistant context/cautions/regime, exposed /api/perpetual-crowding, added collapsible Binance dashboard panel, loaded it with the Binance refresh path, bumped cache to v15, and updated bilingual docs.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verifier-release
  result: Build, packaged health/radar smoke, stock encoding/search regression, browser rendering, secret scan, commit, and push completed.

## Round 2026-08-25l: Bitcoin on-chain health radar
- Baseline: c0f8872 (clean)
### Task 1: Validate keyless on-chain indicators
- status: done
- agent: explorer-onchain
  result: Confirmed Blockchain.com charts provide free 52-week unique-address participation, USD transaction volume, hash rate, miners revenue, and market cap suitable for bounded trend/percentile/NVT analysis.
### Task 2: Implement on-chain radar engine and advisor linkage
- status: done
  agent: implementer-onchain
  result: Implemented Blockchain.com keyless chart aggregation with 30-minute caching, 7d/30d trends, 52-week percentiles, NVT pressure, activity/security scores, bounded regime boost, and Chinese advisor guidance.
### Task 3: Add API route and collapsible dashboard panel
- status: done
  agent: integrator-onchain
  result: Wired GET /api/bitcoin-onchain, added a collapsible Binance dashboard radar with metric cards, signal chips, NVT/advisor summary, refresh action, automatic dashboard loading, and cache v16; integrated the boost and cautions into advisor context.
### Task 4: Review, verify, document, package, and publish
- status: done
  agent: verifier-onchain-release
  result: Build and secret scan passed; packaged smoke confirmed health, cache v16, on-chain radar, advisor linkage, AAPL/TSLA search, readable US names; browser rendering had no overflow or page errors. Bilingual docs updated before commit and push.

## Round 2026-08-25m: Cross-asset correlation and drawdown radar
- Baseline: e64db32 (clean)
### Task 1: Validate keyless cross-asset history and risk model
- status: done
- agent: explorer-cross-asset
  result: Validated Binance public BTC/ETH daily klines and Nasdaq keyless SPY/QQQ/GLD/TLT/HYG history; confirmed 30-day correlation, drawdown, volatility, and diversification scoring are feasible without credentials.
### Task 2: Implement correlation/drawdown engine and advisor linkage
- status: done
- agent: implementer-cross-asset
  result: Added cached cross-asset correlation/drawdown engine with aligned 30-day returns, beta, annualized volatility, state classification, bounded regime boost, Chinese advice, advisor cautions, and market-regime integration.
### Task 3: Add API route and collapsible dashboard panel
- status: done
- agent: integrator-cross-asset
  result: Wired GET /api/cross-asset-correlation, added a collapsible Binance dashboard radar with refresh/action cards and environment score, loaded it through the dashboard path, bumped cache v17, and updated bilingual docs.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verifier-cross-asset-release
  result: Build passed; live API/advisor checks succeeded. Browser validation rendered readable US indices/search results and the new radar without page errors or horizontal overflow; AAPL/TSLA/Palantir search regression passed. Packaging, secret scan, commit, and push completed.

## Round 2026-08-25n: Binance order-flow and book liquidity radar
- Baseline: 157ccaf (clean)
### Task 1: Validate keyless spot taker-flow and depth data
- status: done
- agent: explorer-order-flow
  result: Validated Binance public spot klines expose quote volume and taker-buy quote amount, while public depth provides 100 bid/ask levels; official contract-position sentiment endpoints were unreachable locally, so the radar uses reliable keyless spot execution data.
### Task 2: Implement order-flow/liquidity engine and advisor linkage
- status: done
- agent: implementer-order-flow
  result: Implemented cached BTC/ETH/SOL/BNB/XRP/DOGE radar using 24h taker-buy/sell quote flow, recent-flow acceleration, 100-level book imbalance, spread, near-touch liquidity, confirmation/conflict states, bounded regime boost, and Chinese advisor cautions.
### Task 3: Add API route, collapsible panel, docs, and cache refresh
- status: done
- agent: integrator-order-flow
  result: Wired GET /api/order-flow-liquidity, added a compact collapsible Binance dashboard panel with refresh cards and environment boost, loaded it through the dashboard path, bumped cache v18; live API/advisor smoke passed.
### Task 4: Review, verify, package, and publish
- status: done
- agent: verifier-order-flow-release
  result: Build passed; live API/advisor smoke returned six assets and assistant context. Desktop and mobile browser checks rendered the collapsible radar with no page errors or horizontal overflow; AAPL search regression passed. Added service-worker v19 self-healing for stale pages and clear reconnect/API-unavailable responses instead of stale stock data. Packaged-core smoke confirmed health, Apple/苹果 search, and cache v19; secret scan had only risk-word false positives.

## Round 2026-08-25o: US short-interest crowding radar
- Baseline: 8c672b1 (clean)
### Task 1: Validate Nasdaq keyless short-interest data
- status: done
- agent: explorer-short-interest
  result: Initial checks confirmed Nasdaq public quote API returns 24 settlement periods with short interest, average daily volume, and days-to-cover for Nasdaq-listed AAPL/MSFT/NVDA/TSLA/QQQ; NYSE-listed symbols need a separate fallback or should be excluded from this round.
### Task 2: Implement short-interest engine and advisor linkage
- status: done
- agent: implementer-short-interest
  result: Added a cached keyless snapshot engine with history percentile, trend, crowding/squeeze/covering classification, Chinese advice, bounded advisor regime boost, and direct per-stock signal tilt for AAPL/MSFT/NVDA/TSLA/QQQ.
### Task 3: Add API route and collapsible stock UI
- status: done
- agent: integrator-short-ui
  result: Wired /api/stock/short-interest/:symbol into assistant context/cautions/sources, added a compact collapsible stock radar with quick symbols, search-result linkage, history table, and cache v20.
### Task 4: Review, test, document, package, and publish
- status: done
- agent: verifier-short-release
  result: Build passed; live API/advisor smoke and desktop/mobile browser checks succeeded. Added SEC-merged US ticker search, single-letter search support, explicit search errors, and cache v21; packaged smoke confirmed health, readable AAPL quote, AAPL/apple search, and cache v21. Secret scan had only risk-word false positives. Bilingual docs updated, temporary scripts removed, commit and push completed.

## Round 2026-08-25p: US stock readability and search resilience
- Baseline: 4fe048c (clean)
### Task 1: Add a keyless US equity directory fallback
- status: done
  result: Added a six-hour cached Nasdaq public-screener directory through system curl, covering issuer names, sectors, industries, ticker search, and long-tail companies when Tencent or SEC suggestions are unavailable.
### Task 2: Repair US quote and index names
- status: done
  result: US quotes are now sanitized against the Nasdaq directory when Tencent returns CJK/replacement-character names; Dow, Nasdaq Composite, and S&P 500 use stable Chinese/English canonical labels.
### Task 3: Harden stock search
- status: done
  result: Merged Nasdaq matches into normal search and added it as an independent fallback before the offline list, so ticker/company searches continue even if Smartbox or SEC fails.
### Task 4: Verify, package, and publish
- status: done
  result: Build passed; AAPL/NVDA/Palantir search returned readable English issuer names, US indices rendered correctly, service-worker cache reached v22, packaged health/search/indices smoke passed, and browser checks found no page errors or horizontal overflow.

## Round 2026-08-25q: US market breadth radar
- Baseline: 42c4c7d (clean)
### Task 1: Implement breadth engine and advisor signal
- status: done
- agent: implementer-breadth-engine
- result: Added the Nasdaq screener snapshot engine with advance/decline breadth, strong move ratios, sector and cap tiers, high-liquidity samples, five risk regimes, Chinese advice, confidence, and a bounded advisor boost.
### Task 2: Wire API route and collapsible stock UI
- status: done
- agent: integrator-breadth-ui
- result: Wired /api/stock/market-breadth, added the collapsible stock radar, integrated breadth into assistant warnings/sources/cautions/regime, and bumped cache v23.
### Task 3: Review, build, and end-to-end verify
- status: done
- agent: verifier-breadth-release
- result: Build passed; live breadth API returned 7,185 stocks with a broad Risk-off regime; advisor exposed the boost/caution/source. Desktop and mobile browser checks rendered the radar without overflow or page errors.
### Task 4: Document bilingually, package, and publish
- status: done
- agent: release-breadth
- result: Updated bilingual feature/data-source documentation, added Chinese sector labels, normalized bare US ticker quote IDs, protected quote caches from empty snapshots, bumped cache v24, packaged, and smoke-tested the release.

## Round 2026-08-25r: Institutional ownership radar
- Baseline: 534fc16 (clean)
### Task 1: Validate keyless institutional data source
- status: done
- agent: explorer-institutional
- result: Confirmed Nasdaq's public company endpoint returns institutional ownership percentage, active position breadth, new/sold-out positions, and top holder transactions without credentials; system curl avoids Node fetch challenges.
### Task 2: Implement ownership engine and stock/advisor signal
- status: done
- agent: implementer-institutional
- result: Added the cached Nasdaq institutional-ownership engine with ownership summary, position breadth, net share flow, top-holder changes, accumulation/distribution/mixed classification, Chinese advice, confidence, bounded advisor boost, direct stock-signal tilt, advisor cautions, sources, and context.
### Task 3: Add API route and collapsible stock UI
- status: done
- agent: integrator-institutional
- result: Wired /api/stock/institutional/:symbol, added the collapsible stock radar with quick symbols, position cards, net-flow summary, top-holder table, search linkage, tab loading, and cache v25.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verifier-institutional-release
- result: Build passed. Fixed duplicate us-prefix normalization that made usAAPL/usMSFT/usNVDA/usTSLA quotes empty; added local US-directory caching and avoided the large directory when Tencent already provides valid English names, reducing AAPL search to about 2.5s. Live checks passed for readable US quotes, AAPL institutional accumulation, QQQ 404 tolerance, advisor context/caution/source, and desktop/mobile rendering with zero overflow/page errors. Packaging/release remains.
- result: Packaged core smoke passed health, readable AAPL/MSFT/NVDA/TSLA quotes, AAPL search in about 2.4s, institutional AAPL 200, QQQ 404, and cache v25. Secret scan found only risk-word false positives. Bilingual docs updated and release prepared for commit.

## Round 2026-08-25s: Analyst consensus radar
- Baseline: `821f173` (clean)
### Task 1: Validate free analyst-consensus source
- status: done
- agent: explorer-analyst
- result: Confirmed keyless StockAnalysis forecast pages expose current/12-month consensus ratings, price targets, coverage counts, monthly rating history, recent analyst actions, and company metadata. AAPL/MSFT/NVDA/TSLA are covered; SPY/QQQ are intentionally unavailable.
### Task 2: Implement consensus engine and advisor linkage
- status: done
- agent: implementer-analyst
- result: Added the keyless StockAnalysis forecast parser, current/12-month consensus, rating distribution, median targets, implied upside, monthly shifts, recent actions, Chinese signal/advice/confidence, and a bounded advisor regime boost plus direct stock-signal tilt.
### Task 3: Add API route and collapsible stock UI
- status: done
- agent: integrator-analyst-ui
- result: Wired /api/stock/analyst/:symbol into assistant context/sources/cautions and added a collapsible analyst radar with quick symbols, score/target cards, rating distribution, recent-action table, search-result linkage, tab loading, and cache v26. Moved institutional and analyst radars onto the stocks page.
### Task 4: Review, verify, document, package, and publish
- status: pending
- agent: verifier-analyst-release
- result: Build passed; desktop/mobile browser checks rendered the analyst radar on the stocks page, AAPL search stayed readable, both viewports had zero overflow/console errors. Bumped cache to v27, updated bilingual docs, rebuilt core, and smoke-tested health/readable US quotes/AAPL search/analyst consensus.

## Round 2026-08-25t: Global macro spot radar
- Baseline: `bcf0416` (clean)
### Task 1: Validate keyless macro-spot sources
- status: done
- agent: explorer-macro-spot
- result: Confirmed keyless Tencent overseas quotes expose spot gold/silver plus WTI/Brent prices, day ranges, previous close, and timestamps; Frankfurter ECB USD fixings support a weighted DXY reconstruction with short trend history.
### Task 2: Implement macro-spot engine and advisor linkage
- status: done
- agent: implementer-macro-spot
  result: Added the cached Tencent overseas spot engine plus Frankfurter DXY reconstruction, gold/silver ratio, four macro regimes, Chinese advice/confidence, five-day/twenty-day dollar trend, graceful partial degradation, bounded advisor boost, cautions, sources, and context.
### Task 3: Add API route and collapsible stock UI
- status: done
- agent: integrator-macro-spot-ui
  result: Wired /api/macro/global-spot, added the collapsible global macro spot radar with asset cards, day-range position, dollar trend history, gold/silver ratio, signal interpretation, partial-degradation notice, tab loading, and cache v28.
### Task 4: Review, verify, document, package, and publish
- status: done
- agent: verifier-macro-spot-release
  result: Build passed; live global-spot returned five assets with DXY near 99, balanced signal, and two sources; desktop/mobile browser checks rendered the radar with zero overflow/page errors; cache v28 passed; bilingual docs updated; packaged health/readable AAPL quote/search/global-spot/cache smoke passed; secret scan found no added secrets.

## Round 2026-08-25u: Prediction coverage and probability judgment
- Baseline: `5c7f373` (clean)
### Task 1: Validate additional keyless prediction source
- status: done
- agent: explorer-prediction-coverage
  result: Confirmed Good Judgment Open exposes open questions and public crowd forecasts through keyless HTML; Metaculus now requires an authenticated API token and PredictIt is regionally unreachable, so GJ Open is the safe keyless expansion while Polymarket/Kalshi/Manifold get deeper paging.

## Round 2026-08-25v: Weather radar and Chinese research notes
- Baseline: `5c7f373` (dirty from the prior unpushed notification/radar round)
### Task 1: Add weather coverage
- status: done
- agent: weather-radar
- result: Added supplemental Polymarket, Kalshi, and Manifold weather sweeps; added the weather category and source chip; excluded room-temperature superconductor/weathering false positives; bounded supplemental network waits so the radar degrades quickly.
### Task 2: Add Chinese titles and research notes
- status: done
- agent: chinese-briefs
- result: Added keyless MyMemory title translation with process caching and optional MYMEMORY_EMAIL quota relief; generated local Chinese summaries explaining venue, probability, confidence, volume, deadline, and non-advice status. UI now shows the Chinese title when available, the original title, category label, and research note.
### Task 3: Verify and package
- status: done
- agent: release-weather
- result: TypeScript build passed; packaged core health passed; live radar returned 201 Kalshi, 113 Manifold, 3 GJ Open, and 24 supplemental weather markets in the regional run; desktop and mobile Playwright checks showed 90 cards, 24 filtered weather cards, 90 Chinese summaries, no console errors, and zero horizontal overflow. MyMemory returned 429 during the local smoke, so title translation gracefully omitted while local summaries remained visible; cache reached v30.
