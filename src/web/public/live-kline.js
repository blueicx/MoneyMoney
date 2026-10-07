(function () {
  'use strict';
  function mergeBar(rows, bar) {
    const last = rows[rows.length - 1];
    if (last && bar.time < last.time) return null;
    return (last && bar.time === last.time ? rows.slice(0, -1).concat(bar) : rows.concat(bar)).slice(-1000);
  }
  function canUpdate(c) { return !!c.visible && ['stocks', 'crypto'].includes(c.market) && !c.asOf && !c.date && !c.replay; }
  let source = null, key = '', generation = 0, busy = false, lastPush = 0, nextPoll = 0, abort = null;
  const enabled = { stocks: true, crypto: true };
  function context() {
    try {
      const market = document.getElementById('market-workspace-shell')?.dataset.marketScope;
      const stock = market === 'stocks', card = document.getElementById(stock ? 'stock-chart-card' : 'crypto-chart-card');
      return { market, visible: !document.hidden && window.mm_isLoggedIn === true && !window.mm_isGuest && !!card?.getClientRects().length,
        symbol: stock ? currentStockSymbol : bnCurrentSymbol, interval: stock ? currentStockKlinePeriod : bnCurrentInterval,
        asOf: stock ? stockChartAsOf : '', date: stock ? stockChartIntradayDate : '',
        replay: stock ? (stockChartReplayIndex >= 0 && stockChartReplayIndex < stockChartKlines.length - 1) || !!window.stockMoneyKLine?.timer : !!window.cryptoMoneyKLine?.timer };
    } catch { return { visible: false }; }
  }
  function note(market, text) { const el = document.getElementById('mm-live-status-' + market); if (el) el.textContent = text; }
  function stop() { generation++; key = ''; source?.close(); source = null; abort?.abort(); abort = null; busy = false; lastPush = 0; }
  async function poll(c) {
    if (busy || !canUpdate(context()) || !enabled[c.market]) return;
    const version = generation; busy = true; abort = new AbortController();
    try {
      if (c.market === 'stocks') await loadStockKline(undefined, undefined, undefined, { live: true, signal: abort.signal });
      else await loadBinanceKlines({ live: true, signal: abort.signal });
    } catch { if (version === generation) note(c.market, '自动读取失败 · 保留最后快照'); }
    finally { if (version === generation) { busy = false; abort = null; } }
  }
  function sync() {
    const c = context(), allowed = canUpdate(c) && enabled[c.market];
    const wanted = allowed ? [c.market, c.symbol, c.interval].join('|') : '';
    if (!wanted) { if (key) stop(); note(c.market, !enabled[c.market] ? '自动更新已关闭' : c.asOf || c.date ? '历史日期：自动更新暂停' : c.replay ? 'Replay：自动更新暂停' : '自动更新暂停'); return; }
    if (wanted === key) return;
    stop(); key = wanted; nextPoll = Date.now() + 30000;
    if (c.market === 'stocks') { note(c.market, '每 30 秒读取来源快照 · 不代表交易所实时'); return; }
    note(c.market, '连接推流中 · REST 快照保留');
    const version = generation;
    source = new EventSource('/api/kline-stream?market=crypto&instrument=' + encodeURIComponent('crypto:binance:' + c.symbol) + '&interval=' + encodeURIComponent(c.interval));
    source.addEventListener('state', event => {
      if (version !== generation) return;
      try { const data = JSON.parse(event.data); note(c.market, data.reason || data.connection); const canvas=document.getElementById('bn-candlestick'); if(canvas){canvas.moneySourceMetadata={...canvas.moneySourceMetadata,connection:data.connection,sourceTime:data.updatedAt?Date.parse(data.updatedAt):canvas.moneySourceMetadata?.sourceTime};window.MoneyTradingChart?.redraw(canvas);} } catch { /* Ignore malformed transport frames. */ }
    });
    source.addEventListener('kline', event => {
      if (version !== generation || !canUpdate(context())) return;
      try {
        const data = JSON.parse(event.data), bar = data.bar;
        if (data.instrument !== 'crypto:binance:' + c.symbol || data.timeframe !== c.interval || !bar || !Number.isFinite(bar.time)) return;
        const old = bnKlineData[bnKlineData.length - 1];
        const minutes = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 }[c.interval];
        if (!old || bar.time - old.time > minutes * 60000) { note(c.market, '历史缺口：等待预算内 REST 同步，未补造蜡烛'); return; }
        const rows = mergeBar(bnKlineData, bar); if (!rows) return;
        bnKlineData = rows; lastPush = Date.now();
        document.getElementById('bn-candlestick').moneySourceMetadata={connection:'live',sourceTime:Number.isFinite(data.eventTime)?data.eventTime:null};
        drawCandles(document.getElementById('bn-candlestick'), rows);
        const rsi = document.getElementById('bn-rsi'), macd = document.getElementById('bn-macd');
        if (rsi) drawRSI(rsi, rows); if (macd) drawMACD(macd, rows);
        note(c.market, '推流已连接 · ' + new Date(data.eventTime).toLocaleTimeString() + (bar.closed ? ' · 周期已完成' : ' · 蜡烛形成中（非已确认信号）'));
      } catch { note(c.market, '推流解析失败；保留最后快照'); }
    });
    source.onerror = () => { if (version === generation) { lastPush = 0; nextPoll = 0; note(c.market, '推流断线重连中 · REST 降级，保留最后快照'); } };
  }
  function mount() {
    for (const market of ['stocks', 'crypto']) {
      const card = document.getElementById(market === 'stocks' ? 'stock-chart-card' : 'crypto-chart-card'); if (!card) continue;
      try { enabled[market] = localStorage.getItem('mm-kline-live:' + market) !== 'off'; } catch {}
      const panel = document.createElement('div'); panel.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 0;color:var(--text-secondary);font-size:12px';
      const button = document.createElement('button'); button.className = 'tab'; button.type = 'button';
      button.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;color:var(--text-secondary);min-height:32px;padding:5px 10px';
      function label() { button.textContent = enabled[market] ? '暂停自动更新' : '开启自动更新'; button.setAttribute('aria-pressed', String(enabled[market])); }
      label(); button.onclick = () => { enabled[market] = !enabled[market]; try { localStorage.setItem('mm-kline-live:' + market, enabled[market] ? 'on' : 'off'); } catch {} label(); sync(); };
      const status = document.createElement('span'); status.id = 'mm-live-status-' + market; status.setAttribute('aria-live', 'polite'); panel.append(button, status); card.prepend(panel);
    }
    document.addEventListener('visibilitychange', sync); window.addEventListener('mm-workspace-context', sync); window.addEventListener('pagehide', stop);
    setInterval(() => { sync(); const c = context(); if (key && Date.now() >= nextPoll && (c.market === 'stocks' || Date.now() - lastPush > 20000)) { nextPoll = Date.now() + 30000; void poll(c); } }, 1000);
    sync();
  }
  window.MoneyLiveKline = { mergeBar, canUpdate, sync, stop, note };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
