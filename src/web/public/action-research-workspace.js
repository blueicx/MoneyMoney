(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const markets = { stocks:'股票', options:'期权', crypto:'虚拟币', prediction:'预测市场' };
  const kinds = { changes:'今日变化', upcoming:'未来七天', alert:'待确认提醒', screener:'筛选进出', '13f':'13F 变化', review:'到期复盘' };
  let records = [], controller, lastScope, lifecycleController = new AbortController();
  const saved = key => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
  const pref = saved('mm-action-filter-v1');
  function csrf() { const token = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('mm_csrf=')); return token ? { 'x-csrf-token': decodeURIComponent(token.slice(8)) } : {}; }
  async function api(url, options = {}) {
    const signal = options.signal || lifecycleController.signal;
    const response = await fetch(url, { ...options, signal, headers: { 'content-type':'application/json', ...csrf(), ...options.headers } });
    const body = await response.json();
    signal.throwIfAborted();
    if (!response.ok || body.success === false) throw new Error(body.reason || body.error || `请求失败 ${response.status}`);
    return body;
  }
  function link(row, workspace) { const params = new URLSearchParams({ market:row.market, workspace }); if (row.instrument) params.set('instrument',row.instrument); const at = row.occurredAt || row.publishedAt; if (at) params.set('asOf', at); return '/?' + params; }
  function drawer(row) {
    const overlay = document.createElement('dialog'); overlay.className = 'mm-action-detail';
    const links = [['图表', ({ stocks:'stock-quotes',crypto:'crypto-quotes',options:'option-chain',prediction:'prediction-radar' })[row.market]], ['事件研究','decision-intelligence'], ['决策日记','decision-intelligence']];
    overlay.innerHTML = `<button type="button" data-close aria-label="关闭详情">关闭</button><h3>${esc(row.title)}</h3><p>${esc(row.summary || row.reason || '')}</p><dl><dt>标的 / 市场</dt><dd>${esc(row.instrument || '当前市场')} · ${esc(markets[row.market])}</dd><dt>来源 / 状态</dt><dd>${esc(row.source)} · ${esc(row.dataStatus)}</dd><dt>发生 / 发布时间</dt><dd>${esc(row.occurredAt || '未知')} / ${esc(row.publishedAt || '未知')}</dd><dt>抓取时间</dt><dd>${esc(row.observedAt)}</dd><dt>原因</dt><dd>${esc(row.reason || '无')}</dd></dl><nav>${links.map(([label,workspace]) => `<a href="${esc(link(row,workspace))}">${label}</a>`).join(' ')}${row.sourceUrl ? ` <a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">原文</a>` : ''}</nav><h4>证据引用</h4>${row.evidenceRefs.length ? row.evidenceRefs.map(id => `<a href="/api/evidence/${encodeURIComponent(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a>`).join('<br>') : '<p>此记录尚无独立证据快照</p>'}`;
    const evidenceLinks = [...overlay.querySelectorAll('h4 ~ a')];
    evidenceLinks.forEach((anchor,index) => { const ref = row.evidenceRefs[index]; if (/^https?:\/\//i.test(ref)) anchor.href = ref; });
    for (const anchor of overlay.querySelectorAll('nav a')) {
      if (!['事件研究','决策日记'].includes(anchor.textContent)) continue;
      anchor.onclick = async event => {
        event.preventDefault();
        try {
          if (!row.instrument) throw new Error('此记录没有明确标的，无法建立事件研究或日记');
          if (anchor.textContent === '事件研究' && (!row.publishedAt || Date.parse(row.publishedAt) > Date.now() || row.occurredAt && Date.parse(row.occurredAt) > Date.now())) throw new Error('事件尚未发生或缺少发布时间，只可建立决策草稿');
          let refs = row.evidenceRefs.filter(id => !/^https?:/i.test(id));
          if (!refs.length) {
            const result = await api('/api/evidence',{ method:'POST',body:JSON.stringify({ market:row.market,instrument:row.instrument,workspace:'event-intelligence',dataStatus:row.dataStatus,source:{ id:'action-center:'+row.market,name:row.source,url:row.sourceUrl || null },observedAt:row.publishedAt || row.observedAt,fetchedAt:row.observedAt,fields:{ title:row.title,kind:row.kind,publishedAt:row.publishedAt || null,occurredAt:row.occurredAt || null,sourceUrl:row.sourceUrl || null } }) });
            refs = [result.data.id];
          }
          window.setMarketScope(row.market); window.setWorkspaceInstrument(row.instrument); window.openWorkspace('decision-intelligence');
          window.mm_decisionEvidenceIds = [...new Set([...(window.mm_decisionEvidenceIds || []),...refs])];
          if (anchor.textContent === '决策日记') { const field = document.getElementById('decision-thesis'); if (field) { field.value = `围绕「${row.title}」的研究假设：`; field.focus(); } }
          else { const at = new Date(Math.max(Date.parse(row.publishedAt),Date.parse(row.occurredAt || row.publishedAt))); const field = document.getElementById('event-study-at'); if (field) field.value = new Date(at.getTime()-at.getTimezoneOffset()*60000).toISOString().slice(0,16); const title = document.getElementById('event-study-title'); if (title) title.value = row.title; window.mm_selectedStudyEventId = row.eventId || null; window.mm_selectedStudyEventEvidenceId = refs[0]; }
          overlay.close();
        } catch (error) { let notice=overlay.querySelector('[data-error]'); if (!notice) { notice=document.createElement('p');notice.dataset.error='true';overlay.append(notice); } notice.textContent=error.message; }
      };
    }
    overlay.querySelector('[data-close]').onclick = () => overlay.close();
    overlay.addEventListener('close', () => overlay.remove(), { once:true }); document.body.append(overlay); overlay.showModal();
  }
  function render() {
    const host = document.getElementById('mm-action-list'); if (!host) return;
    const meta = {};
    for (const row of records) {
      if (!row.instrument) continue;
      const item = meta[row.instrument] || { pending:0,upcoming:Infinity,status:0 };
      if (!row.read && !row.snoozed) item.pending++;
      if (row.section === 'upcoming') item.upcoming=Math.min(item.upcoming,Date.parse(row.occurredAt || row.publishedAt));
      item.status=Math.max(item.status,({ failed:4,unavailable:4,partial:3,cached:2,delayed:1 })[row.dataStatus] || 0);
      meta[row.instrument]=item;
    }
    window.mmActionSortMeta=meta;
    window.dispatchEvent(new Event('mm-action-items-updated'));
    const section = document.getElementById('mm-action-section').value, market = document.getElementById('mm-action-market').value;
    pref.section = section; pref.market = market; try { localStorage.setItem('mm-action-filter-v1', JSON.stringify(pref)); } catch {}
    const rows = records.filter(row => (!section || row.section === section) && (!market || row.market === market) && (!row.snoozed || document.getElementById('mm-action-snoozed').checked));
    const previousScroll = host.scrollTop;
    host.innerHTML = rows.length ? rows.map(row => `<article class="mm-action-row ${row.read ? 'is-read' : ''}" data-id="${esc(row.id)}"><button type="button" data-detail><strong>${row.pinned ? '📌 ' : ''}${esc(row.title)}</strong><small>${esc(markets[row.market])} · ${esc(row.instrument || '市场记录')} · ${esc(row.dataStatus)} · ${esc(row.observedAt)}</small><span>${esc(row.summary || row.reason || '')}</span></button><div><button data-read>${row.read ? '标未读' : '已读'}</button><button data-pin>${row.pinned ? '取消置顶' : '置顶'}</button><button data-snooze>${row.snoozed ? '恢复处理' : '稍后一天'}</button></div></article>`).join('') : '<p class="empty-tip">当前筛选暂无可处理记录。来源失败会单独显示，不表示没有事件。</p>';
    host.scrollTop = previousScroll;
    for (const article of host.querySelectorAll('article')) {
      const row = records.find(row => row.id === article.dataset.id);
      article.querySelector('[data-detail]').onclick = () => drawer(row);
      const update = async change => { try { const result = await api('/api/watchlist/action-center/' + encodeURIComponent(row.id), { method:'PATCH', body:JSON.stringify(change) }); Object.assign(row,result.data); row.snoozed = Boolean(row.snoozedUntil && Date.parse(row.snoozedUntil) > Date.now()); render(); } catch (error) { article.querySelector('small').textContent = error.message; } };
      article.querySelector('[data-read]').onclick = () => update({ read:!row.read });
      article.querySelector('[data-pin]').onclick = () => update({ pinned:!row.pinned });
      article.querySelector('[data-snooze]').onclick = () => update({ snoozedUntil:row.snoozed ? null : new Date(Date.now() + 86400_000).toISOString() });
    }
  }
  async function loadActions() {
    controller?.abort(); controller = new AbortController(); const signal = controller.signal;
    const status = document.getElementById('mm-action-status'); status.textContent = '正在读取自选来源与处理记录…';
    try { const result = await api('/api/watchlist/action-center', { signal }); if (signal.aborted) return; records = result.items; status.textContent = `${result.counts.unread} 项待处理 · ${result.dataStatus} · ${result.updatedAt}${result.reason ? ' · ' + result.reason : ''}`; render(); }
    catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
  }
  function drawCurves(host, series) {
    const valid = series.filter(row => row.values?.some(Number.isFinite));
    if (!valid.length) { host.innerHTML = '<p>暂无可用曲线数据</p>'; return; }
    const values = valid.flatMap(row => row.values.filter(Number.isFinite)), min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const colors = ['#f5b94c','#6bc8ec','#b397fa','#69db9c','#f08f99','#fafafa'];
    host.innerHTML = `<svg viewBox="0 0 900 260" role="img" aria-label="真实历史比较曲线"><text x="4" y="16" fill="currentColor">${esc(max.toFixed(4))}</text><text x="4" y="250" fill="currentColor">${esc(min.toFixed(4))}</text>${valid.map((row,index) => `<polyline fill="none" stroke="${colors[index % colors.length]}" stroke-width="2" points="${row.values.map((value,i) => Number.isFinite(value) ? `${70 + i / Math.max(1,row.values.length-1)*810},${240 - (value-min)/span*215}` : '').filter(Boolean).join(' ')}"/>`).join('')}</svg><p>${valid.map((row,i) => `<span style="color:${colors[i % colors.length]}">${esc(row.label)}</span>`).join(' · ')}</p>`;
  }
  function install() {
    const parent = document.getElementById('workspace-watchlist-panel'); if (!parent || document.getElementById('mm-action-center')) return;
    const section = document.createElement('section'); section.id = 'mm-action-center'; section.className = 'mm-action-center';
    section.innerHTML = `<h3>自选行动与研究中心</h3><p>私人处理状态与证据 · 不执行真实交易</p><div class="mm-action-tools"><button id="mm-action-refresh">加载 / 刷新行动</button><select id="mm-action-market" aria-label="行动市场"><option value="">全部市场</option>${Object.entries(markets).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select><select id="mm-action-section" aria-label="行动类别"><option value="">全部类别</option>${Object.entries(kinds).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select><label><input type="checkbox" id="mm-action-snoozed">显示稍后处理</label></div><p id="mm-action-status" role="status">点击加载，读取真实自选记录。</p><div id="mm-action-list" aria-live="polite"></div><details><summary>研究实验并排比较</summary><label>市场 <select id="mm-experiment-market">${Object.entries(markets).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><button id="mm-experiment-load">读取实验</button><div id="mm-experiment-options"></div><button id="mm-experiment-compare">比较选中实验（2–6个）</button><div id="mm-experiment-result" role="status"></div></details><details><summary>真实历史与快照比较</summary><label>市场 <select id="mm-history-market"><option value="options">期权</option><option value="crypto">虚拟币</option><option value="prediction">预测市场</option></select></label><label>规范标的 ID <input id="mm-history-id" placeholder="option:cboe:AAPL"></label><p>Binance 现货与 Gate.io 永续分开归档；预测市场用当前官方事件 ID，不猜测。</p><button id="mm-history-load">读取历史</button><button id="mm-history-capture">保存当前真实快照</button><div id="mm-history-result" role="status"></div></details>`;
    parent.append(section);
    const forward = document.createElement('details');
    forward.innerHTML = `<summary>信号前向观察</summary><label>市场 <select data-forward-market>${Object.entries(markets).map(([id,name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><button data-forward-load>读取已完成K线观察</button><div data-forward-result role="status"></div>`;
    section.append(forward);
    forward.querySelector('[data-forward-load]').onclick = async () => {
      const host = forward.querySelector('[data-forward-result]'); host.textContent = '正在读取已发布历史分区…';
      try { const result = await api('/api/signals/forward?market='+forward.querySelector('select').value); host.innerHTML = result.data.length ? result.data.map(row => `<article><h4>${esc(row.strategyId || row.id)} / ${esc(row.strategyVersion || '未关联')} · ${esc(row.timeframe || '')} · ${esc(row.source || '')}</h4><p>${esc(row.instrument)} · MFE ${esc(row.mfePct ?? '不可用')}% · MAE ${esc(row.maePct ?? '不可用')}% · ${esc(row.warning || row.reason || '')}</p><div data-forward-curve="${esc(row.id)}"></div><p>${esc(row.historyReason || '')}</p>${row.experimentId ? `<a href="/api/research/experiments/${encodeURIComponent(row.experimentId)}" target="_blank" rel="noopener noreferrer">关联实验</a>` : '<p>实验未关联</p>'}</article>`).join('') : esc(result.reason); for (const row of result.data) { const target=[...host.querySelectorAll('[data-forward-curve]')].find(node=>node.dataset.forwardCurve===row.id); if (target && row.points.length) drawCurves(target,[{ label:row.instrument+'（仅已完成K线）',values:row.points.map(point=>point.returnPct) }]); } } catch (error) { host.textContent=error.message; }
    };
    document.getElementById('mm-action-market').value = pref.market || ''; document.getElementById('mm-action-section').value = pref.section || '';
    document.getElementById('mm-action-refresh').onclick = loadActions;
    for (const id of ['mm-action-market','mm-action-section','mm-action-snoozed']) document.getElementById(id).onchange = render;
    document.getElementById('mm-experiment-load').onclick = async () => {
      const host = document.getElementById('mm-experiment-options'); host.textContent = '正在读取…';
      try { const result = await api('/api/research/experiments?market=' + document.getElementById('mm-experiment-market').value); host.innerHTML = result.data.length ? result.data.map(row => `<label><input type="checkbox" value="${esc(row.id)}">${esc(row.strategyId || '未命名策略')} · ${esc(row.instrument)} · ${esc(row.createdAt)} · ${esc(row.id)}</label>`).join('<br>') : esc(result.reason); } catch (error) { host.textContent = error.message; }
    };
    document.getElementById('mm-experiment-compare').onclick = async () => {
      const host = document.getElementById('mm-experiment-result'), ids = [...document.querySelectorAll('#mm-experiment-options input:checked')].map(input => input.value);
      try { const result = await api('/api/research/experiments/compare?ids=' + encodeURIComponent(ids.join(','))); host.innerHTML = `<p>${esc(result.data.warnings.join('；') || result.reason)}</p><h4>资金曲线</h4><div data-curves></div><h4>回撤（%）</h4><div data-drawdowns></div><table><thead><tr><th>实验</th><th>收益</th><th>样本外</th><th>成本</th><th>数据区间</th></tr></thead><tbody>${result.data.experiments.map(row => `<tr><td>${esc(row.id)}</td><td>${esc(row.metrics.totalReturnPct)}%</td><td>${esc(row.outOfSample.totalReturnPct)}%</td><td>费率 ${esc(row.feeRate)} / 滑点 ${esc(row.slippage)}<br>实际费用 ${esc(row.totalFees ?? '不可用')} / 滑点成本 ${esc(row.totalSlippage ?? '不可用')}<br>成交 ${esc(row.trades.length)} 笔</td><td>${esc(row.dataFrom)}—${esc(row.dataTo)}<br>${esc(row.freshness?.reason || row.freshnessReason)}</td></tr>`).join('')}</tbody></table><p>配置差异：${esc(result.data.differences.map(row => row.field).join('、') || '无')}</p>`; drawCurves(host.querySelector('[data-curves]'), result.data.experiments.map(row => ({ label:row.id,values:row.equityCurve }))); drawCurves(host.querySelector('[data-drawdowns]'), result.data.experiments.map(row => ({ label:row.id,values:row.drawdownCurve }))); } catch (error) { host.textContent = error.message; }
    };
    const history = async capture => {
      const market = document.getElementById('mm-history-market').value, instrument = document.getElementById('mm-history-id').value.trim(), host = document.getElementById('mm-history-result'); host.textContent = '正在读取实际来源…';
      try {
        if (capture) await api(market === 'options' ? '/api/options/history/save' : '/api/market-history/capture', { method:'POST', body:JSON.stringify({ market,instrument }) });
        const result = await api(market === 'options' ? '/api/options/history/compare?instrument=' + encodeURIComponent(instrument) : '/api/market-history?' + new URLSearchParams({ market,instrument }));
        if (market === 'options') {
          host.innerHTML = `<p>${esc(result.reason || '相邻同源、同合约快照')} · ${esc(result.source)}</p><div class="mm-history-coverage">${result.data.coverage.map(row => `<span title="${esc(row.source)}">${esc(row.at.slice(0,10))}</span>`).join(' ')}</div>${result.data.changes.map(change => `<h4>${esc(change.fromAt)} → ${esc(change.toAt)}</h4><table><thead><tr><th>合约</th><th>报价变化</th><th>IV变化</th><th>成交量变化</th><th>OI变化</th></tr></thead><tbody>${change.contracts.map(row => `<tr><td>${esc(row.contract)}</td>${['bidPrice','impliedVolPct','volume','openInterest'].map(field => `<td>${esc(row.fields[field].delta ?? row.fields[field].reason)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')}`;
        } else {
          const series = result.series, fields = market === 'prediction' ? ['probability','liquidity'] : ['fundingRatePct','openInterestUsd','bidDepthUsd','askDepthUsd','spreadPct'];
          host.innerHTML = `<p>${esc(result.reason || '同交易场所、同来源快照；不推算缺失历史')} · ${esc(result.source)}</p><div data-curves></div><table><thead><tr><th>时间 / 来源</th>${fields.map(field => `<th>${field}</th>`).join('')}</tr></thead><tbody>${series.map(row => `<tr><td>${esc(row.observedAt)}<br>${esc(row.source.name)}</td>${fields.map(field => `<td>${esc(row.fields[field] ?? '字段不可用')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
          // Different units/sources are never overlaid as a misleading single series.
          for (const field of fields) for (const source of [...new Set(series.map(row => row.source.id))]) {
            const points = series.filter(row => row.source.id === source && Number.isFinite(row.fields[field])); if (!points.length) continue;
            const curve = document.createElement('div'); host.querySelector('[data-curves]').append(curve); drawCurves(curve,[{ label:field + ' · ' + source, values:points.map(row => row.fields[field]) }]);
          }
        }
      } catch (error) { host.textContent = error.message; }
    };
    document.getElementById('mm-history-load').onclick = () => history(false); document.getElementById('mm-history-capture').onclick = () => history(true);
  }
  function initialize() {
    install(); const shell = document.getElementById('market-workspace-shell');
    if (shell) new MutationObserver(() => { const scope = shell.dataset.marketScope; if (scope !== lastScope) { controller?.abort(); lifecycleController.abort(); lifecycleController=new AbortController(); records=[]; lastScope = scope; for (const id of ['mm-action-list','mm-experiment-options','mm-experiment-result','mm-history-result']) { const panel=document.getElementById(id); if (panel) panel.replaceChildren(); } } const host = document.getElementById('mm-action-center'); if (host) host.hidden = window.mm_isGuest === true || window.mm_isLoggedIn !== true; }).observe(shell,{ attributes:true,attributeFilter:['data-market-scope'] });
    let attempts = 0;
    const authCheck = setInterval(() => { const host = document.getElementById('mm-action-center'); if (host) host.hidden = window.mm_isGuest === true || window.mm_isLoggedIn !== true; if (window.mm_isLoggedIn === true || ++attempts > 20) clearInterval(authCheck); },500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize,{ once:true }); else initialize();
})();
